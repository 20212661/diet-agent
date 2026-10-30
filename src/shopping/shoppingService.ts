import { createHash } from "node:crypto";
import { getDatabase } from "../store/database.js";
import { getIngredientInventory, replaceIngredientInventoryIfCurrent } from "../store/repositories/inventoryRepository.js";
import { generateId, todayDate } from "../store/shared.js";
import { WebWriteConflictError } from "../web/writeOnce.js";
import { combinedAmount } from "./quantity.js";
import { providerId, getShoppingProviders } from "./providers.js";
import type { ShoppingTask, ShoppingItem, ReceiveItem } from "./types.js";
import type { IngredientItem } from "../types/diet.js";

export class ShoppingError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); }
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ShoppingError(`${label}必填，最多 ${max} 个字符。`);
  return value.trim();
}
function sourceKey(item: IngredientItem): string {
  return JSON.stringify([item.id, item.name, item.amount ?? "", item.unit ?? "", item.storage ?? "", item.status ?? "planned"]);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,val]) => [key,canonical(val)]));
  return value;
}
function rowTask(row: Record<string, unknown>): ShoppingTask {
  const receipts = getDatabase().prepare("SELECT details_json,created_at FROM shopping_events WHERE user_id=? AND task_id=? AND type='received' ORDER BY created_at,id").all(row.user_id, row.id) as {details_json:string;created_at:string}[];
  return { id: row.id as string, userId: row.user_id as string, title: row.title as string, provider: row.provider as ShoppingTask["provider"],
    items: JSON.parse(row.items_json as string), status: row.status as ShoppingTask["status"], version: row.version as number,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    receiptHistory: receipts.map(r => ({createdAt:r.created_at, items:JSON.parse(r.details_json)})) };
}
export function getShoppingTask(userId: string, id: string): ShoppingTask {
  const row = getDatabase().prepare("SELECT * FROM shopping_tasks WHERE user_id=? AND id=?").get(userId, id) as Record<string, unknown> | undefined;
  if (!row) throw new ShoppingError("找不到采购任务。", 404);
  return rowTask(row);
}
export function listShoppingTasks(userId: string, limit = 50, offset = 0): ShoppingTask[] {
  return (getDatabase().prepare("SELECT * FROM shopping_tasks WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(userId, limit, offset) as Record<string, unknown>[]).map(rowTask);
}
function event(task: ShoppingTask, type: string, details: unknown) {
  const createdAt = new Date().toISOString();
  getDatabase().prepare("INSERT INTO shopping_events VALUES (?,?,?,?,?,?)").run(generateId("sev"), task.userId, task.id, type, JSON.stringify(details), createdAt);
  if (type === "received") task.receiptHistory = [...(task.receiptHistory ?? []), {createdAt,items:details as ReceiveItem[]}];
}
export function shoppingStatus(items: ShoppingItem[]): ShoppingTask["status"] {
  if (items.every(i => i.status === "cancelled")) return "cancelled";
  if (items.every(i => ["received", "cancelled"].includes(i.status))) return "completed";
  if (items.some(i => ["received", "partially_received"].includes(i.status))) return "partially_received";
  const active = items.filter(i => i.status !== "cancelled");
  if (active.every(i => i.status === "pending")) return "draft";
  if (active.every(i => i.status === "ordered")) return "ordered";
  return "in_progress";
}
function save(task: ShoppingTask): ShoppingTask {
  task.status = shoppingStatus(task.items); task.version++; task.updatedAt = new Date().toISOString();
  const hadReceipt = getDatabase().prepare("SELECT 1 FROM shopping_receipts WHERE user_id=? AND task_id=? LIMIT 1").get(task.userId, task.id);
  if (hadReceipt && task.status !== "completed") {
    task.status = task.items.every(i => ["received", "cancelled"].includes(i.status)) ? "completed" : "partially_received";
  }
  getDatabase().prepare("UPDATE shopping_tasks SET items_json=?,status=?,version=?,updated_at=? WHERE user_id=? AND id=?")
    .run(JSON.stringify(task.items), task.status, task.version, task.updatedAt, task.userId, task.id);
  return task;
}
function current(userId: string, id: string, version: unknown): ShoppingTask {
  const task = getShoppingTask(userId, id);
  if (task.version !== version) throw new WebWriteConflictError("采购任务已修改，请刷新核对后重试。");
  return task;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(i => typeof i !== "string") || new Set(value).size !== value.length) throw new ShoppingError("请选择 1–100 个不同条目。");
  return value;
}
export function createShoppingTask(userId: string, payload: Record<string, unknown>): ShoppingTask {
  return getDatabase().transaction(() => {
    const inventory = getIngredientInventory(userId);
    if (inventory.updatedAt !== payload.inventoryUpdatedAt) throw new WebWriteConflictError("待购清单已修改，请刷新。");
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw new ShoppingError("请选择采购条目。");
    const selected = new Set<string>();
    const items: ShoppingItem[] = payload.items.map(raw => {
      if (!raw || typeof raw !== "object") throw new ShoppingError("采购条目无效。");
      const input = raw as Record<string, unknown>;
      const source = inventory.shoppingList.find(i => i.id === input.sourceItemId && i.status === "planned");
      if (!source || selected.has(source.id!)) throw new ShoppingError("采购条目已变化或重复。");
      selected.add(source.id!);
      const amount = input.amount === undefined ? source.amount : typeof input.amount === "string" && input.amount.length <= 200 ? input.amount.trim() : undefined;
      if (input.amount !== undefined && amount === undefined) throw new ShoppingError("数量最多 200 个字符。");
      return { id: generateId("sit"), name: source.name, ...(amount ? {amount} : {}), sourceItem: source, status: "pending" };
    });
    // Query all active tasks, not just the paginated UI list.
    const active = (getDatabase().prepare("SELECT * FROM shopping_tasks WHERE user_id=? AND status NOT IN ('completed','cancelled')").all(userId) as Record<string, unknown>[]).map(rowTask);
    if (payload.allowDuplicate !== true && active.some(t => t.items.some(i => selected.has(i.sourceItem?.id ?? "") && !["received", "cancelled"].includes(i.status)))) {
      throw new ShoppingError("这些食材已有未完成采购任务，请查看已有任务，或明确选择额外采购。", 409);
    }
    const now = new Date().toISOString();
    const task: ShoppingTask = { id: generateId("shop"), userId, title: text(payload.title ?? "食材采购", "任务标题", 100), provider: providerId(payload.provider), items, status: "draft", version: 1, createdAt: now, updatedAt: now };
    getDatabase().prepare("INSERT INTO shopping_tasks VALUES (?,?,?,?,?,?,?,?,?)").run(task.id, userId, task.title, task.provider, JSON.stringify(items), task.status, 1, now, now);
    event(task, "created", { itemIds: items.map(i => i.id) }); return task;
  })();
}
export function changeShoppingItems(userId: string, id: string, payload: Record<string, unknown>, action: "ordered" | "cancelled"): ShoppingTask {
  return getDatabase().transaction(() => {
    const task = current(userId, id, payload.expectedVersion);
    const selected = ids(payload.itemIds);
    for (const itemId of selected) {
      const item = task.items.find(i => i.id === itemId);
      if (!item || ["received", "cancelled"].includes(item.status) || (action === "ordered" && item.status !== "pending")) throw new ShoppingError("所选条目不能执行此操作。");
      item.status = action;
    }
    save(task); event(task, action === "ordered" ? "user_marked_ordered" : "cancelled_remaining", {itemIds: selected}); return task;
  })();
}
export function editShoppingItem(userId: string, id: string, itemId: string, payload: Record<string, unknown>): ShoppingTask {
  return getDatabase().transaction(() => {
    const task = current(userId, id, payload.expectedVersion);
    const item = task.items.find(i => i.id === itemId);
    if (!item || item.status !== "pending") throw new ShoppingError("仅可修改尚未下单的需求。");
    item.amount = typeof payload.amount === "string" && payload.amount.length <= 200 ? payload.amount.trim() : undefined;
    if (payload.amount !== undefined && item.amount === undefined) throw new ShoppingError("数量文字无效。");
    save(task); event(task, "edited", {itemId}); return task;
  })();
}
export function shoppingHandoff(userId: string, id: string) {
  const task = getShoppingTask(userId, id);
  const provider = getShoppingProviders(userId).find(p => p.id === task.provider)!;
  if (!provider.entryUrl) throw new ShoppingError("先配置并验证这个平台的购物入口。");
  event(task, "handoff", { provider: task.provider });
  return { url: provider.entryUrl, verifiedAt: provider.verifiedAt, statusSource: "user_verified" };
}
export function receiveShoppingItems(userId: string, id: string, payload: Record<string, unknown>) {
  return getDatabase().transaction(() => {
    const db = getDatabase();
    const operationId = text(payload.operationId, "操作 ID");
    if (operationId.length < 8) throw new ShoppingError("操作 ID 至少 8 个字符。");
    // Bind receipt identity to full input, not just quantities.
    const requestHash = createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
    const prior = db.prepare("SELECT request_hash,result_json FROM shopping_receipts WHERE user_id=? AND task_id=? AND operation_id=?").get(userId, id, operationId) as {request_hash:string; result_json:string} | undefined;
    if (prior) {
      if (prior.request_hash !== requestHash) throw new WebWriteConflictError();
      return JSON.parse(prior.result_json) as { task: ShoppingTask; inventory: ReturnType<typeof getIngredientInventory> };
    }
    const task = current(userId, id, payload.expectedVersion);
    const inventory = getIngredientInventory(userId);
    if (inventory.updatedAt !== payload.inventoryUpdatedAt) throw new WebWriteConflictError("库存已修改，请刷新核对后收货。");
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw new ShoppingError("请选择收到的食材。");
    const selected = new Set<string>(), mergeTargets = new Set<string>();
    const received: ReceiveItem[] = payload.items.map(raw => {
      if (!raw || typeof raw !== "object") throw new ShoppingError("收货条目无效。");
      const input = raw as Record<string, unknown>;
      const itemId = text(input.itemId, "条目 ID");
      if (selected.has(itemId)) throw new ShoppingError("收货条目重复。");
      selected.add(itemId);
      if (typeof input.complete !== "boolean" || !["fridge", "freezer", "pantry", "room_temp"].includes(String(input.storage))) throw new ShoppingError("请确认是否收齐以及存放位置。");
      const amount = input.amount === undefined || input.amount === "" ? undefined : text(input.amount, "实收数量");
      return { itemId, name: text(input.name, "实际食材名称", 100), amount, storage: input.storage as ReceiveItem["storage"], complete: input.complete,
        ...(input.mergeTargetId ? {mergeTargetId: text(input.mergeTargetId, "合并目标 ID")} : {}),
        ...(input.mergedAmount ? {mergedAmount: text(input.mergedAmount, "合并后数量")} : {}) };
    });
    received.sort((a,b) => a.itemId.localeCompare(b.itemId));
    const receiptFingerprint = JSON.stringify(received);
    const duplicate = db.prepare("SELECT 1 FROM shopping_events WHERE user_id=? AND task_id=? AND type='received' AND details_json=?").get(userId, id, receiptFingerprint);
    if (duplicate && payload.confirmDuplicate !== true) throw new ShoppingError("发现相同收货记录。若确实为第二批收货，请勾选确认重复内容后重试。", 409);
    for (const input of received) {
      const item = task.items.find(i => i.id === input.itemId);
      if (!item || ["received", "cancelled"].includes(item.status)) throw new ShoppingError("该条目已完成或取消。");
      const source = item.sourceItem;
      if (input.complete && source) {
        const currentSource = inventory.shoppingList.find(i => i.id === source.id);
        if (!currentSource || sourceKey(currentSource) !== sourceKey(source)) throw new WebWriteConflictError("原待购条目已修改或移除，请恢复并核对需求后收货，或改为部分收货保留清单。");
        // Other open tasks sharing this source retain the pending item until the last one completes.
        const otherTasks = db.prepare("SELECT items_json FROM shopping_tasks WHERE user_id=? AND id<>? AND status NOT IN ('completed','cancelled')").all(userId, id) as {items_json:string}[];
        const neededElsewhere = otherTasks.some(t => (JSON.parse(t.items_json) as ShoppingItem[]).some(i => i.sourceItem?.id === source.id && !["received", "cancelled"].includes(i.status)));
        if (!neededElsewhere) inventory.shoppingList = inventory.shoppingList.filter(i => i.id !== source.id);
      }
      if (input.mergeTargetId) {
        if (mergeTargets.has(input.mergeTargetId)) throw new ShoppingError("同一批确认不能多次合并到同一库存，请分开核对。");
        mergeTargets.add(input.mergeTargetId);
        const target = inventory.availableIngredients.find(i => i.id === input.mergeTargetId && i.isAvailable);
        if (!target || target.name !== input.name || target.storage !== input.storage) throw new ShoppingError("只能合并到同名、同存放位置的可用库存。");
        const calculated = combinedAmount(target.amount ?? "", input.amount ?? "");
        if (!calculated && !input.mergedAmount) throw new ShoppingError("单位或规格无法换算，请填写核对后的合并总数量，或保存为独立批次。");
        target.amount = input.mergedAmount ?? calculated!;
      } else {
        inventory.availableIngredients.push({ id: generateId("ing"), name: input.name, amount: input.amount, storage: input.storage, status: "available", purchasedAt: todayDate(), purchaseBatchId: `${id}:${operationId}:${input.itemId}` });
      }
      item.status = input.complete ? "received" : "partially_received";
    }
    const saved = replaceIngredientInventoryIfCurrent(userId, inventory.updatedAt, inventory.availableIngredients, inventory.shoppingList);
    if (saved.status !== "updated") throw new WebWriteConflictError("库存已修改。");
    save(task); event(task, "received", received);
    const result = { task, inventory: saved.inventory };
    db.prepare("INSERT INTO shopping_receipts VALUES (?,?,?,?,?,?)").run(userId, id, operationId, requestHash, JSON.stringify(result), new Date().toISOString());
    return result;
  })();
}
