import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import * as validation from "../web/payloadValidation.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const { saveProfile, saveKitchen, saveInventory } = await import("../web/profileWrites.js");
const { createChatOperationHandler } = await import("../web/chatStream.js");
const { claimChatOperation } = await import("../web/chatOperationStore.js");
const { receiptImage, parseReceiptImage } = await import("../web/receiptParser.js");
const models = await import("../agent/modelAdapter.js");
const agent = await import("../agent/createDietAgent.js");

beforeEach(() => { vi.restoreAllMocks(); store.closeDatabase(); });
const body = (text: string) => Readable.from([Buffer.from(text)]) as IncomingMessage;

describe("拆分后的 Web 请求校验", () => {
  it("校验 JSON 内容和请求体大小", async () => {
    expect(await validation.readJson(body('{"name":"苹果"}'))).toEqual({ name: "苹果" });
    await expect(validation.readJson(body("[]"))).rejects.toThrow("Invalid JSON");
    await expect(validation.readJson(body("broken"))).rejects.toThrow();
    await expect(validation.readJson(body('{"name":"苹果"}'), 2)).rejects.toThrow("too large");
  });

  it("餐食创建和局部编辑保留契约，拒绝未知字段和无效日期", () => {
    expect(validation.parseMealPayload({ date: "2030-04-08", mealType: "lunch", foods: [{ name: " 米饭 ", amount: "1碗", note: "备注" }], note: "餐食" }, true))
      .toMatchObject({ foods: [{ name: "米饭", amount: "1碗", note: "备注" }] });
    expect(validation.parseMealPayload({ note: "编辑" }, false)).toEqual({ note: "编辑" });
    for (const payload of [{ unexpected: true }, { date: "2030-02-30" }, { mealType: "invalid" }, { foods: [] },
      { foods: [null] }, { foods: [{ name: "米饭", calories: 1 }] }, { foods: [{ name: "" }] }, { note: "x".repeat(1001) }]) {
      expect(() => validation.parseMealPayload(payload, false)).toThrow();
    }
    expect(() => validation.parseMealPayload({}, true)).toThrow();
    expect(() => validation.parseMealPayload({ mealType: "lunch" }, true)).toThrow();
  });

  it("库存校验保留日期、状态和可清空字段", () => {
    expect(validation.parseInventoryItem({ name: " 苹果 ", amount: " 1个 ", storage: "fridge", expiresAt: "2030-04-08", status: "available" }, true))
      .toMatchObject({ name: "苹果", amount: "1个", storage: "fridge" });
    expect(validation.parseInventoryItem({ storage: "", expiresAt: "" }, false)).toEqual({ storage: "", expiresAt: "" });
    for (const payload of [{ unknown: 1 }, { name: "" }, { amount: 1 }, { storage: "invalid" }, { expiresAt: "invalid" }, { status: "invalid" }]) {
      expect(() => validation.parseInventoryItem(payload, false)).toThrow();
    }
    expect(() => validation.parseInventoryItem({}, true)).toThrow();
    expect(validation.ingredientList([{ name: "苹果", id: "id", amount: "1", unit: "个", category: "fruit", storage: "fridge", status: "available", expiresAt: "2030-04-08", purchasedAt: "2030-04-07", note: "备注" }], "库存")).toHaveLength(1);
    for (const items of [null, [null], [{ name: "" }], [{ name: "苹果", extra: true }], [{ name: "苹果", status: "bad" }], [{ name: "苹果", expiresAt: "bad" }]]) {
      expect(() => validation.ingredientList(items, "库存")).toThrow();
    }
  });

  it("基础字段校验拒绝非法输入", () => {
    expect(validation.optionalText(" 苹果 ", "名称")).toBe("苹果");
    expect(validation.optionalText(null, "名称")).toBeUndefined();
    expect(validation.optionalNumber("2", "数量", 0, 3)).toBe(2);
    expect(validation.optionalNumber(undefined, "数量", 0, 3)).toBeUndefined();
    expect(validation.optionalEnum("a", ["a"], "选项")).toBe("a");
    expect(validation.optionalEnum("", ["a"], "选项")).toBeUndefined();
    expect(validation.stringList([" 苹果 ", ""], "列表")).toEqual(["苹果"]);
    expect(() => validation.optionalText(1, "名称")).toThrow();
    expect(() => validation.optionalNumber("NaN", "数量", 0, 3)).toThrow();
    expect(() => validation.optionalEnum("b", ["a"], "选项")).toThrow();
    expect(() => validation.stringList([1], "列表")).toThrow();
  });
});

describe("表单保存保留并发冲突保护", () => {
  it("显式空值清除资料字段，而未提供的字段保留", () => {
    const userId = "profile_clear";
    store.upsertUserProfile(userId, { goal: "custom", activityLevel: "high", customGoal: "旧目标",
      weightKg: 70, heightCm: 175, age: 30, gender: "男" });
    saveProfile(userId, { updatedAt: store.getUserProfile(userId)!.updatedAt,
      goal: "", activityLevel: null, customGoal: " ", weightKg: "", age: null, gender: "",
      avoidFoods: [], preferences: [], allergies: [], medicalNotes: [] });
    const profile = store.getUserProfile(userId)!;
    expect(profile.heightCm).toBe(175);
    for (const key of ["goal", "activityLevel", "customGoal", "weightKg", "age", "gender"] as const) {
      expect(profile[key]).toBeUndefined();
    }
    expect(store.getDatabase().prepare("SELECT weight_kg, custom_goal FROM user_profiles WHERE user_id = ?").get(userId))
      .toEqual({ weight_kg: null, custom_goal: null });
  });
  it("资料、厨房与库存只接受当前版本", () => {
    const userId = "web-module-test";
    saveProfile(userId, { updatedAt: "", goal: "maintain", activityLevel: "low", heightCm: 170, weightKg: 60, age: 25,
      avoidFoods: [], preferences: [], allergies: [], medicalNotes: [] });
    expect(store.getUserProfile(userId)?.goal).toBe("maintain");
    expect(() => saveProfile(userId, { updatedAt: "" })).toThrow("其他操作修改");
    const kitchen = store.getKitchenProfile(userId);
    saveKitchen(userId, { updatedAt: kitchen.updatedAt, burners: 0, hasOven: false, hasMicrowave: false,
      hasRiceCooker: false, maxActiveMinutes: 10, maxTotalMinutes: 15, cookware: [], tastePreferences: [], cookingPreferences: [] });
    expect(store.getKitchenProfile(userId).burners).toBe(0);
    expect(() => saveKitchen(userId, { updatedAt: kitchen.updatedAt })).toThrow("其他操作修改");
    expect(() => saveKitchen(userId, { updatedAt: store.getKitchenProfile(userId).updatedAt, hasOven: "yes" })).toThrow();
    const inventory = store.getIngredientInventory(userId);
    saveInventory(userId, { updatedAt: inventory.updatedAt, availableIngredients: [{ name: "苹果" }], shoppingList: [] });
    expect(store.getIngredientInventory(userId).availableIngredients[0]?.name).toBe("苹果");
    expect(() => saveInventory(userId, { updatedAt: inventory.updatedAt, availableIngredients: [], shoppingList: [] })).toThrow("其他操作修改");
    expect(() => saveInventory(userId, {})).toThrow();
  });
});

describe("聊天流拆分后仍保持操作幂等与恢复", () => {
  it("并发同 ID 只调用一次，重启处理器读回终态并拒绝内容冲突", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => { await gate; return { userId: "chat-test", reply: "已完成", sessionId: "session" }; });
    const stream = createChatOperationHandler("chat-test", send);
    const firstEvents: any[] = []; const secondEvents: any[] = [];
    const first = stream("operation-123", "记录午饭", false, (event) => firstEvents.push(event));
    const second = stream("operation-123", "记录午饭", false, (event) => secondEvents.push(event));
    await stream("operation-123", "不同内容", false, (event) => secondEvents.push(event));
    release(); await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(firstEvents.at(-1)).toMatchObject({ type: "done", reply: "已完成" });
    expect(secondEvents.at(-1)).toMatchObject({ type: "done" });
    const restarted = createChatOperationHandler("chat-test", send);
    await restarted("operation-123", "记录午饭", false, (event) => secondEvents.push(event));
    await restarted("operation-123", "另一条消息", false, (event) => secondEvents.push(event));
    expect(send).toHaveBeenCalledTimes(1);
    expect(secondEvents.at(-1)).toMatchObject({ type: "failed_before_write" });
  });

  it("只有写入前失败可以重试，写入后的中断必须核对", async () => {
    const failed = vi.fn(async () => { throw new Error("network"); });
    const stream = createChatOperationHandler("chat-failure", failed);
    const events: any[] = [];
    await stream("failed-operation", "hello", false, (event) => events.push(event));
    await stream("failed-operation", "hello", true, (event) => events.push(event));
    expect(failed).toHaveBeenCalledTimes(2);
    expect(events.at(-1).type).toBe("failed_before_write");
    const interrupted = createChatOperationHandler("chat-write", async (_user, _message, options) => {
      options?.onToolStatus?.({ toolName: "log_meal", phase: "pending" });
      throw new Error("after write");
    });
    await interrupted("write-operation", "记录", false, (event) => events.push(event));
    expect(events.at(-1).type).toBe("result_uncertain");
    claimChatOperation(store.getDatabase(), "chat-restart", "running-operation", "中断", false);
    await createChatOperationHandler("chat-restart", failed)("running-operation", "中断", true, (event) => events.push(event));
    expect(events.at(-1).type).toBe("result_uncertain");
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("转发文本、工具与需要核对的业务结果", async () => {
    const events: any[] = [];
    const stream = createChatOperationHandler("chat-verification", async (userId, _message, options) => {
      options?.onTextDelta?.("增量回复");
      options?.onToolStatus?.({ toolName: "log_meal", phase: "success" });
      return { userId, reply: "核对记录", sessionId: "session", status: "verification_required", refreshedData: { meals: [] } };
    });
    await stream("verification-operation", "记录", false, (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(["start", "text", "tool", "result_uncertain"]);
    expect(events.at(-1).refreshedData).toEqual({ meals: [] });
  });
});

describe("小票解析输入与模型结果", () => {
  it("拒绝错误类型、损坏与过大图片", () => {
    expect(receiptImage({ mimeType: "image/png", data: "YWJj" })).toMatchObject({ type: "image", data: "YWJj" });
    expect(() => receiptImage({ mimeType: "text/plain", data: "YWJj" })).toThrow();
    expect(() => receiptImage({ mimeType: "image/png", data: "invalid" })).toThrow();
    expect(() => receiptImage({ mimeType: "image/png", data: "a".repeat(6_000_010) })).toThrow();
  });

  it("只保留识别结果允许的食材字段，并处理模型错误", async () => {
    vi.spyOn(models, "resolveModelCandidates").mockReturnValue([{ model: { input: ["image"] } } as never]);
    const complete = vi.fn(async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ items: [null,
      { name: " 苹果 ", amount: " 1个 ", category: "fruit", storage: "room_temp", address: "不要保留" },
      { name: "西兰花", category: "bad", storage: "bad" }] }) }] }));
    vi.spyOn(agent, "getConfiguredModelRuntime").mockResolvedValue({ completeSimple: complete } as never);
    const image = receiptImage({ mimeType: "image/png", data: "YWJj" });
    expect(await parseReceiptImage(image)).toEqual([{ name: "苹果", amount: "1个", category: "fruit", storage: "room_temp" },
      { name: "西兰花", category: "other", storage: "fridge" }]);
    for (const text of ["not json", "{broken}", '{"items":[]}', '{"unexpected":true}']) {
      complete.mockResolvedValueOnce({ stopReason: "stop", content: [{ type: "text", text }] });
      await expect(parseReceiptImage(image)).rejects.toThrow();
    }
    complete.mockResolvedValueOnce({ stopReason: "error", content: [] });
    await expect(parseReceiptImage(image)).rejects.toThrow("暂时不可用");
    vi.mocked(models.resolveModelCandidates).mockReturnValue([]);
    await expect(parseReceiptImage(image)).rejects.toThrow("不支持图片识别");
  });
});

describe("Web 中间件与辅助函数", () => {
  it("回环地址与主机头防护校验", async () => {
    const { isLoopbackHost, hasAllowedHostHeader, hasAllowedOrigin, isApiWriteRoute, verifySecurity } = await import("../web/middleware/security.js");
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("192.168.1.100")).toBe(false);
    expect(isLoopbackHost("evil.com")).toBe(false);

    expect(hasAllowedHostHeader({ headers: { host: "127.0.0.1:4173" } } as never, 4173)).toBe(true);
    expect(hasAllowedHostHeader({ headers: { host: "localhost:4173" } } as never, 4173)).toBe(true);
    expect(hasAllowedHostHeader({ headers: { host: "127.0.0.1:8080" } } as never, 4173)).toBe(false);
    expect(hasAllowedHostHeader({ headers: { host: "evil.com:4173" } } as never, 4173)).toBe(false);
    expect(hasAllowedHostHeader({ headers: {} } as never, 4173)).toBe(false);

    expect(hasAllowedOrigin({ headers: { origin: "http://127.0.0.1:4173" } } as never, 4173)).toBe(true);
    expect(hasAllowedOrigin({ headers: { origin: "http://localhost:4173" } } as never, 4173)).toBe(true);
    expect(hasAllowedOrigin({ headers: { origin: "http://evil.com:4173" } } as never, 4173)).toBe(false);
    expect(hasAllowedOrigin({ headers: { origin: "null" } } as never, 4173)).toBe(false);
    expect(hasAllowedOrigin({ headers: {} } as never, 4173)).toBe(true);

    expect(isApiWriteRoute("POST", "/api/profile")).toBe(true);
    expect(isApiWriteRoute("PATCH", "/api/inventory/items/item-1")).toBe(true);
    expect(isApiWriteRoute("POST", "/api/weekly-plan/2026-09-21/day/2026-09-21/replace")).toBe(true);
    expect(isApiWriteRoute("DELETE", "/api/meals/meal-1")).toBe(true);
    expect(isApiWriteRoute("GET", "/api/dashboard")).toBe(false);

    const mockResponse = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
    });
    const badHostRes = mockResponse();
    expect(verifySecurity({ headers: { host: "evil.com:4173" } } as never, badHostRes as never, 4173, new URL("http://evil.com:4173/api/dashboard"))).toBe(false);
    expect(badHostRes.writeHead).toHaveBeenCalledWith(421, expect.any(Object));

    const badOriginRes = mockResponse();
    expect(verifySecurity({ method: "POST", headers: { host: "127.0.0.1:4173", origin: "http://evil.com", "content-type": "application/json" } } as never, badOriginRes as never, 4173, new URL("http://127.0.0.1:4173/api/profile"))).toBe(false);
    expect(badOriginRes.writeHead).toHaveBeenCalledWith(403, expect.any(Object));

    const badContentTypeRes = mockResponse();
    expect(verifySecurity({ method: "POST", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173", "content-type": "text/plain" } } as never, badContentTypeRes as never, 4173, new URL("http://127.0.0.1:4173/api/profile"))).toBe(false);
    expect(badContentTypeRes.writeHead).toHaveBeenCalledWith(415, expect.any(Object));
  });

  it("错误响应辅助函数正确映射状态码", async () => {
    const { sendWriteError } = await import("../web/helpers/http.js");
    const { WebWriteConflictError } = await import("../web/writeOnce.js");
    const res1 = { writeHead: vi.fn(), end: vi.fn() };
    sendWriteError(res1 as never, new WebWriteConflictError("冲突"), "回退");
    expect(res1.writeHead).toHaveBeenCalledWith(409, expect.any(Object));

    const res2 = { writeHead: vi.fn(), end: vi.fn() };
    sendWriteError(res2 as never, new Error("常规校验失败"), "回退");
    expect(res2.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("静态文件映射包含所有前端拆分模块", async () => {
    const { staticFiles } = await import("../web/helpers/staticFiles.js");
    for (const file of [
      "/app.js",
      "/chatController.js",
      "/planDialog.js",
      "/recoveryStore.js",
      "/viewFormatters.js",
      "/profileKitchenViews.js",
      "/inventoryView.js",
      "/diaryView.js",
      "/planAgentViews.js",
      "/styles.css",
      "/index.html",
    ]) {
      expect(staticFiles[file]).toBeDefined();
    }
  });
});

