import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const shopping = await import("../shopping/shoppingService.js");
const providers = await import("../shopping/providers.js");
const { combinedAmount } = await import("../shopping/quantity.js");
const privacy = await import("../privacy/userData.js");
const { createShoppingTaskTool, getShoppingTasksTool } = await import("../tools/shopping.js");
const { wrapToolsForUser } = await import("../agent/modelAdapter.js");
const userId = "shopping-tests";
beforeEach(() => store.closeDatabase());
function setup(names = ["番茄", "鸡蛋"]) {
  const inventory = store.upsertIngredientInventory(userId, {shoppingList: names.map(name => ({name, amount: "500 克", status: "planned" as const}))});
  const task = shopping.createShoppingTask(userId, {provider: "meituan", inventoryUpdatedAt: inventory.updatedAt, items: inventory.shoppingList.map(i => ({sourceItemId: i.id}))});
  return {task, inventory};
}
function receive(task: ReturnType<typeof shopping.getShoppingTask>, inventory: ReturnType<typeof store.getIngredientInventory>, complete = true, extra = {}) {
  return {operationId: "receipt-operation-001", expectedVersion: task.version, inventoryUpdatedAt: inventory.updatedAt, items: [{itemId: task.items[0].id, name: task.items[0].name, amount: "200 克", storage: "fridge", complete}], ...extra};
}
describe("采购任务及原子收货", () => {
  it("仅确定的同维度数量可以相加，不推测包盒规格", () => {
    expect(combinedAmount("0.5 kg", "200 克")).toBe("700 克");
    expect(combinedAmount("1 升", "200 ml")).toBe("1200 毫升");
    expect(combinedAmount("1 盒", "10 个")).toBeNull();
    expect(combinedAmount("1 盒", "1 盒")).toBeNull();
    expect(combinedAmount("200 克", "1 个")).toBeNull();
  });
  it("稳定空库存版本、用户隔离、重复采购提示及已下单不入库", () => {
    expect(store.getIngredientInventory(userId).updatedAt).toBe("empty");
    const {task, inventory} = setup();
    expect(() => shopping.getShoppingTask("other", task.id)).toThrow("找不到");
    expect(shopping.listShoppingTasks("other")).toEqual([]);
    expect(() => shopping.createShoppingTask(userId, {provider: "taobao", inventoryUpdatedAt: inventory.updatedAt, items: [{sourceItemId: inventory.shoppingList[0].id}]})).toThrow("未完成");
    const ordered = shopping.changeShoppingItems(userId, task.id, {expectedVersion: 1, itemIds: [task.items[0].id]}, "ordered");
    expect(ordered.status).toBe("in_progress");
    expect(store.getIngredientInventory(userId).availableIngredients).toEqual([]);
    expect(() => shopping.changeShoppingItems(userId, task.id, {expectedVersion: 1, itemIds: [task.items[1].id]}, "ordered")).toThrow("已修改");
  });
  it("分批收货保留批次，不重复入库，并绑定幂等 ID 内容", () => {
    const {task, inventory} = setup(["番茄"]);
    const input = receive(task, inventory, false);
    const first = shopping.receiveShoppingItems(userId, task.id, input);
    expect(first.task.status).toBe("partially_received");
    expect(first.inventory.shoppingList).toHaveLength(1);
    expect(shopping.receiveShoppingItems(userId, task.id, input)).toEqual(first);
    expect(shopping.receiveShoppingItems(userId, task.id, {items:input.items, inventoryUpdatedAt:input.inventoryUpdatedAt, expectedVersion:input.expectedVersion, operationId:input.operationId})).toEqual(first);
    expect(() => shopping.receiveShoppingItems(userId, task.id, {...input, items: [{...input.items[0], amount: "201 克"}]})).toThrow("请求 ID");
    const second = shopping.receiveShoppingItems(userId, task.id, receive(first.task, first.inventory, true, {operationId: "receipt-operation-002"}));
    expect(second.task.status).toBe("completed");
    expect(second.task.receiptHistory).toHaveLength(2);
    expect(second.inventory.availableIngredients).toHaveLength(2);
    expect(new Set(second.inventory.availableIngredients.map(i => i.purchaseBatchId)).size).toBe(2);
    expect(second.inventory.shoppingList).toHaveLength(0);
    // The old inventory upsert must preserve both purchase batches.
    expect(store.upsertIngredientInventory(userId, {availableIngredients: [{name:"其他食材"}]}).availableIngredients).toHaveLength(3);
  });
  it("相同内容新操作提示重复；确认后可以收到真实第二批", () => {
    const {task, inventory} = setup(["番茄"]);
    const first = shopping.receiveShoppingItems(userId, task.id, receive(task, inventory, false));
    const input = receive(first.task, first.inventory, false, {operationId: "receipt-operation-002"});
    expect(() => shopping.receiveShoppingItems(userId, task.id, input)).toThrow("相同收货");
    expect(shopping.receiveShoppingItems(userId, task.id, {...input, confirmDuplicate:true}).inventory.availableIngredients).toHaveLength(2);
  });
  it("错误条目、库存冲突和原需求修改全部回滚", () => {
    const {task, inventory} = setup();
    const input = receive(task, inventory);
    expect(() => shopping.receiveShoppingItems(userId, task.id, {...input, items: [...input.items, {...input.items[0], itemId: "missing"}]})).toThrow();
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(0);
    expect(shopping.getShoppingTask(userId, task.id).version).toBe(1);
    const changed = store.upsertIngredientInventory(userId, {shoppingList: [{...inventory.shoppingList[0], amount:"1 kg"}]});
    expect(() => shopping.receiveShoppingItems(userId, task.id, input)).toThrow("库存已修改");
    expect(() => shopping.receiveShoppingItems(userId, task.id, {...input, inventoryUpdatedAt:changed.updatedAt})).toThrow("待购条目");
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(0);
  });
  it("明确合并兼容数量、未知单位需要填写总数、替代品独立入库", () => {
    const {task, inventory} = setup();
    const inv = store.upsertIngredientInventory(userId, {availableIngredients:[{name:"番茄", amount:"500 克", storage:"fridge"}]});
    const input = receive(task, inv, true);
    const result = shopping.receiveShoppingItems(userId, task.id, {...input, items:[{...input.items[0], mergeTargetId:inv.availableIngredients[0].id}]});
    expect(result.inventory.availableIngredients).toHaveLength(1);
    expect(result.inventory.availableIngredients[0].amount).toBe("700 克");
    const eggItem = result.task.items[1];
    const unknown = {operationId:"receipt-operation-003", expectedVersion:result.task.version, inventoryUpdatedAt:result.inventory.updatedAt, items:[{itemId:eggItem.id, name:"番茄", amount:"1 盒", storage:"fridge", complete:true, mergeTargetId:inv.availableIngredients[0].id}]};
    expect(() => shopping.receiveShoppingItems(userId, task.id, unknown)).toThrow("无法换算");
    const final = shopping.receiveShoppingItems(userId, task.id, {...unknown, items:[{...unknown.items[0], mergedAmount:"900 克"}]});
    expect(final.inventory.availableIngredients[0].amount).toBe("900 克");
    expect(final.task.status).toBe("completed");
    expect(inventory.shoppingList).toHaveLength(2);
  });
  it("部分收到后取消剩余仍保留入库历史", () => {
    const {task, inventory} = setup(["番茄"]);
    const first = shopping.receiveShoppingItems(userId, task.id, receive(task, inventory, false));
    const cancelled = shopping.changeShoppingItems(userId, task.id, {expectedVersion:first.task.version, itemIds:[task.items[0].id]}, "cancelled");
    expect(cancelled.status).toBe("completed");
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(1);
  });
  it("编辑数量有版本保护，全部取消未收货任务", () => {
    const {task} = setup(["番茄"]);
    const edited = shopping.editShoppingItem(userId, task.id, task.items[0].id, {expectedVersion:1, amount:"1 kg"});
    expect(edited.items[0].amount).toBe("1 kg");
    expect(() => shopping.editShoppingItem(userId, task.id, task.items[0].id, {expectedVersion:1, amount:""})).toThrow();
    expect(shopping.changeShoppingItems(userId, task.id, {expectedVersion:2,itemIds:[task.items[0].id]}, "cancelled").status).toBe("cancelled");
  });
  it("额外任务共享需求时，直到全部满足才移除待购项", () => {
    const {task, inventory} = setup(["番茄"]);
    const extra = shopping.createShoppingTask(userId, {provider:"taobao", allowDuplicate:true, inventoryUpdatedAt:inventory.updatedAt, items:[{sourceItemId:inventory.shoppingList[0].id}]});
    const first = shopping.receiveShoppingItems(userId, task.id, receive(task, inventory));
    expect(first.inventory.shoppingList).toHaveLength(1);
    const last = shopping.receiveShoppingItems(userId, extra.id, receive(extra, first.inventory));
    expect(last.inventory.shoppingList).toHaveLength(0);
  });
  it("平台链接拒绝伪造域名、内网和非 HTTPS，交接不改变采购状态", () => {
    const {task} = setup();
    for (const url of ["https://meituan.com.evil.test/", "https://evilmeituan.com/", "http://meituan.com", "https://127.0.0.1", "javascript:alert(1)", "https://user:pass@meituan.com", "https://meituan.com:8080/"]) expect(() => providers.validateEntryUrl("meituan", url)).toThrow();
    expect(() => shopping.shoppingHandoff(userId, task.id)).toThrow("配置");
    expect(() => providers.saveShoppingProvider(userId, "meituan", "https://www.meituan.com/", false)).toThrow("确认");
    providers.saveShoppingProvider(userId, "meituan", "https://www.meituan.com/", true);
    expect(shopping.shoppingHandoff(userId, task.id).url).toBe("https://www.meituan.com/");
    expect(shopping.getShoppingTask(userId, task.id).status).toBe("draft");
    expect(providers.getShoppingProviders("other")[0].status).toBe("unconfigured");
    providers.saveShoppingProvider(userId, "meituan", "", false);
    expect(providers.getShoppingProviders(userId)[0].status).toBe("unconfigured");
  });
  it("采购数据进入导出和删除，其他用户数据保留", () => {
    const {task} = setup();
    const inv = store.getIngredientInventory(userId);
    shopping.receiveShoppingItems(userId, task.id, receive(task, inv));
    providers.saveShoppingProvider(userId, "taobao", "https://tb.ele.me/", true);
    const other = "other-shopping";
    providers.saveShoppingProvider(other, "meituan", "https://www.meituan.com/", true);
    const overview = privacy.getUserDataOverview(userId);
    expect(overview.database.shoppingTasks).toBe(1);
    expect(overview.database.shoppingReceipts).toBe(1);
    const path = privacy.exportUserData(userId, []);
    const exported = JSON.parse(readFileSync(path,"utf8"));
    expect(exported.database.shopping.shopping_tasks).toHaveLength(1);
    privacy.deleteUserData(userId, () => {});
    expect(shopping.listShoppingTasks(userId)).toEqual([]);
    expect(providers.getShoppingProviders(other)[0].status).toBe("user_verified");
  });
  it("Agent 绑定当前用户，同一工具调用只建一次采购草稿", async () => {
    const inv = store.upsertIngredientInventory(userId, {shoppingList:[{name:"番茄",status:"planned"}]});
    const tools = wrapToolsForUser(userId, [createShoppingTaskTool, getShoppingTasksTool]);
    const raw = {userId:"other", provider:"meituan", inventoryUpdatedAt:inv.updatedAt, sourceItemIds:[inv.shoppingList[0].id]};
    const params = tools[0].prepareArguments!(raw);
    const first = await tools[0].execute("call-unique-001", params, undefined, undefined, undefined as any);
    expect((first.details as any).task.userId).toBe(userId);
    expect(await tools[0].execute("call-unique-001", params, undefined, undefined, undefined as any)).toEqual(first);
    expect(shopping.listShoppingTasks(userId)).toHaveLength(1);
  });
  it("整表编辑保持相同名称的独立批次身份且剔除计算字段", () => {
    const source = readFileSync(new URL("../../public/inventoryView.js", import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export function/g,"function");
    const parse = runInNewContext(source+"\nparseIngredientLines", {list:(v:unknown)=>v});
    const existing = [{id:randomUUID(),name:"番茄",amount:"200 克",storage:"fridge",purchaseBatchId:"receipt-1",isAvailable:true}, {id:randomUUID(),name:"番茄",amount:"200 克",storage:"fridge",purchaseBatchId:"receipt-2",isAvailable:true}];
    const parsed = parse("番茄 | 200 克 | 冷藏\n番茄 | 200 克 | 冷藏", existing);
    expect(parsed.map((i:any)=>i.id)).toEqual(existing.map(i=>i.id));
    expect(parsed.map((i:any)=>i.purchaseBatchId)).toEqual(["receipt-1","receipt-2"]);
    expect(parsed[0].isAvailable).toBeUndefined();
  });
});
