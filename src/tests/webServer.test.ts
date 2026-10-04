import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { staticFiles } from "../web/helpers/staticFiles.js";
import { recipeBlockReason } from "../recipes/executionConstraints.js";
import { todayDate } from "../store/shared.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const { createWebServer } = await import("../web/server.js");
const { claimChatOperation, finishChatOperation } = await import("../web/chatOperationStore.js");
const weeklyService = await import("../services/weeklyPlanService.js");
const doctor = await import("../agent/configDoctor.js");

const userId = "HTTP 用户 B";
let server: Server;
let base: string;
let sequence = 0;
beforeEach(async () => {
  store.closeDatabase();
  server = createWebServer({ userId, host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  store.closeDatabase();
});

async function request(path: string, payload?: Record<string, unknown>, method = "POST", identity: string | null = userId) {
  const response = await fetch(base + path, {
    method: payload === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json", ...(identity === null ? {} : { "X-Diet-User-Id": encodeURIComponent(identity) }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
const operation = (payload: Record<string, unknown> = {}) => ({ operationId: `http-regression-${++sequence}`, ...payload });

describe("Web 服务 HTTP 边界与拆分路由", () => {
  it("异常路径返回 400，服务仍能处理后续请求", async () => {
    for (const path of ["/api/recipes/%ZZ", "/api/recipes/%E0%A4%A", "/api/weekly-plan/%/day/2030-04-08/alternatives", "/unknown/%FF"]) {
      expect((await request(path)).status).toBe(400);
      expect((await request("/api/dashboard")).status).toBe(200);
    }
    expect((await request("/api/recipes/" + encodeURIComponent("不存在的菜谱"))).status).toBe(404);
    expect((await request("/unknown")).status).toBe(404);
  });

  it("路由意外异常由入口返回 500，不泄露细节且服务可继续使用", async () => {
    const spy = vi.spyOn(weeklyService, "findRecipe").mockImplementationOnce(() => { throw new Error("private-database-path"); });
    const failed = await request("/api/recipes/test");
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain("private-database-path");
    spy.mockRestore();
    expect((await request("/api/dashboard")).status).toBe(200);
  });

  it("缺失或旧用户身份的恢复请求不领取操作、不调用模型、不写新用户记录", async () => {
    const message = "用户 A 的待恢复消息";
    const payload = operation({ message, retry: true });
    for (const identity of [null, "用户 A"]) {
      const rejected = await request("/api/chat", payload, "POST", identity);
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe("user_changed");
      expect((await request("/api/meals", operation({ mealType: "dinner", foods: [{ name: "米饭" }] }), "POST", identity)).status).toBe(409);
    }
    const malformed = await fetch(base + "/api/chat", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Diet-User-Id": "%ZZ",
    }, body: JSON.stringify(payload) });
    expect(malformed.status).toBe(409);
    expect(store.getDatabase().prepare("SELECT count(*) AS n FROM chat_operations").get()).toEqual({ n: 0 });
    expect(store.getMealLogsByDate(userId, todayDate())).toHaveLength(0);
    // A matching Unicode identity can query a persisted result without a model call.
    claimChatOperation(store.getDatabase(), userId, payload.operationId, message, false);
    finishChatOperation(store.getDatabase(), userId, payload.operationId, { type: "done", status: "done", reply: "已保存结果" });
    const accepted = await fetch(base + "/api/chat", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(userId),
    }, body: JSON.stringify(payload) });
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain('"reply":"已保存结果"');
  });

  it("聊天校验失败返回 JSON，未创建操作", async () => {
    for (const payload of [operation({ message: "" }), operation({ message: "x".repeat(12001) }), { message: "hello" }]) {
      expect((await request("/api/chat", payload)).status).toBe(400);
    }
    const response = await fetch(base + "/api/chat", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(userId),
    }, body: "broken" });
    expect(response.status).toBe(400);
  });

  it("静态模块从 HTTP 入口全部可加载，安全响应头与 404 保持有效", async () => {
    for (const path of Object.keys(staticFiles)) {
      const response = await fetch(base + path);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(await response.text()).toBeTruthy();
    }
    expect((await request("/missing.js")).status).toBe(404);
  });

  it("饮食路由支持创建、幂等回放、编辑、删除及恢复", async () => {
    const date = "2030-04-08";
    const payload = operation({ date, mealType: "dinner", foods: [{ name: "米饭", amount: "1碗" }] });
    const saved = await request("/api/meals", payload);
    expect(saved.status).toBe(201);
    expect((await request("/api/meals", payload)).body.meal.id).toBe(saved.body.meal.id);
    const endpoint = `/api/meals/${saved.body.meal.id}`;
    expect((await request(endpoint, operation({ note: "已编辑" }), "PATCH")).body.meal.note).toBe("已编辑");
    expect((await request("/api/meals?date=" + date)).body.meals).toHaveLength(1);
    expect((await request("/api/meals/dates?limit=14")).body.dates).toContain(date);
    expect((await request(endpoint, operation(), "DELETE")).body.deleted).toBe(true);
    expect((await request("/api/meals?date=" + date)).body.deletedMeals).toHaveLength(1);
    expect((await request(endpoint + "/restore", operation())).status).toBe(200);
    expect((await request("/api/meals?date=" + date)).body.meals).toHaveLength(1);
    expect((await request("/api/meals?date=2030-02-30")).status).toBe(400);
    expect((await request("/api/meals", operation({ mealType: "wrong", foods: [] }))).status).toBe(400);
  });

  it("资料、厨房与库存路由保留版本冲突和写入去重契约", async () => {
    const initial = (await request("/api/dashboard")).body;
    const profile = operation({ updatedAt: "", goal: "maintain", allergies: ["花生"], avoidFoods: [], preferences: [], medicalNotes: [] });
    expect((await request("/api/profile", profile)).status).toBe(200);
    expect((await request("/api/profile", operation({ updatedAt: "", goal: "fat_loss" }))).status).toBe(409);
    expect((await request("/api/kitchen", operation({ updatedAt: initial.kitchen.updatedAt, burners: 1 }))).status).toBe(200);
    expect((await request("/api/kitchen", operation({ updatedAt: "stale", burners: 2 }))).status).toBe(409);
    expect((await request("/api/inventory", operation({ updatedAt: initial.inventory.updatedAt,
      availableIngredients: [{ name: "番茄" }], shoppingList: [] }))).status).toBe(200);
    expect((await request("/api/inventory", operation({ updatedAt: "stale", availableIngredients: [], shoppingList: [] }))).status).toBe(409);
    const added = await request("/api/inventory/items", operation({ name: "黄瓜" }));
    expect(added.status).toBe(201);
    const itemUrl = `/api/inventory/items/${added.body.item.id}`;
    expect((await request(itemUrl, operation({ updatedAt: added.body.updatedAt, amount: "2根" }), "PATCH")).status).toBe(200);
    expect((await request(itemUrl, operation({ updatedAt: added.body.updatedAt, amount: "3根" }), "PATCH")).status).toBe(409);
    expect((await request(itemUrl, operation({ amount: "3根" }), "PATCH")).status).toBe(400);
    expect((await request("/api/inventory/import", operation({ items: [{ name: "土豆" }] }))).status).toBe(200);
    expect((await request("/api/inventory/import", operation({ items: [] }))).status).toBe(400);
    expect((await request("/api/receipt/parse", { data: "invalid", mimeType: "image/png" })).status).toBe(400);
  });

  it("周计划路由检查日期、候选、版本和当前可采购项", async () => {
    const week = "2030-04-08", date = week;
    const kitchen = store.getKitchenProfile(userId);
    const recipe = store.getRecipeBook().find((item) => !recipeBlockReason(item, kitchen))!;
    store.upsertWeeklyPlan(userId, week, [{ date, dayOfWeek: 1, mainRecipe: {
      id: recipe.id, name: recipe.name, activeMinutes: recipe.activeMinutes, totalMinutes: recipe.totalMinutes,
    }, staplesSuggestion: "米饭", reasons: [], missingIngredients: [], completed: false }]);
    expect((await request(`/api/recipes/${recipe.id}`)).body.recipe.id).toBe(recipe.id);
    const dayUrl = `/api/weekly-plan/${week}/day/${date}`;
    const alternatives = (await request(dayUrl + "/alternatives")).body;
    expect(alternatives.status).toBe("ok");
    expect((await request("/api/weekly-plan/bad/day/bad/alternatives")).status).toBe(400);
    expect((await request("/api/weekly-plan/2030-04-15/day/2030-04-15/alternatives")).status).toBe(404);
    expect((await request(dayUrl + "/replace", operation({ updatedAt: alternatives.updatedAt, recipeId: "missing" }))).status).toBe(422);
    expect((await request(dayUrl + "/replace", operation({ updatedAt: "stale", recipeId: recipe.id }))).status).toBe(409);
    const candidate = alternatives.alternatives[0].recipe;
    const replaced = await request(dayUrl + "/replace", operation({ updatedAt: alternatives.updatedAt, recipeId: candidate.id }));
    expect(replaced.status).toBe(200);
    const completed = await request(dayUrl + "/complete", operation({ updatedAt: replaced.body.plan.updatedAt, recipeId: candidate.id, completed: true }));
    expect(completed.status).toBe(200);
    expect(completed.body.plan.days[0].completed).toBe(true);
    expect((await request(dayUrl + "/complete", operation({ updatedAt: "stale", recipeId: candidate.id, completed: false }))).status).toBe(409);
    const plan = completed.body.plan;
    const items = plan.days[0].ingredientReadiness.filter((item: { status: string }) => item.status === "to_add_to_list").map((item: { ingredient: string }) => item.ingredient);
    const shopping = { weekStartDate: week, date, updatedAt: plan.updatedAt, recipeIds: [candidate.id], items };
    expect(items.length).toBeGreaterThan(0);
    expect((await request("/api/shopping-list/add-from-plan", operation({ ...shopping, items: ["不在计划里的食材"] }))).status).toBe(422);
    expect((await request("/api/shopping-list/add-from-plan", operation(shopping))).status).toBe(200);
    expect((await request("/api/shopping-list/add-from-plan", operation({ ...shopping, recipeIds: ["missing"] }))).status).toBe(409);
  });

  it("模型验证结果与失败恢复通过仪表盘返回，不调用真实模型", async () => {
    const check = vi.spyOn(doctor, "checkModelConfiguration").mockResolvedValueOnce({
      ok: true, severity: "ok", code: "ready", message: "测试通过", nextStep: "开始使用",
    } as never).mockRejectedValueOnce(new Error("network unavailable"));
    expect((await request("/api/model/check", {})).body.modelCheck.ok).toBe(true);
    expect((await request("/api/model/check", {})).body.modelCheck.code).toBe("network_error");
    expect(check).toHaveBeenCalledTimes(2);
  });
});
