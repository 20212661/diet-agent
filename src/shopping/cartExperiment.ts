import { randomUUID } from "node:crypto";
import { getDatabase } from "../store/database.js";
import { WebWriteConflictError } from "../web/writeOnce.js";
import { getShoppingTask, ShoppingError, text } from "./shoppingService.js";

export interface CartRow {store: string; title: string; specification: string; quantity: number; priceCents: number | null}
interface Selection extends CartRow {itemId: string; specificationConfirmed: true; availableConfirmed: true}
interface CartStep {id: string; itemId: string; product: CartRow; addQuantity: number; status: "pending" | "awaiting_reconciliation" | "confirmed" | "unknown" | "mismatch"; startedAt?: string}
export interface CartExperiment {
  id: string; userId: string; taskId: string; taskVersion: number; version: number;
  provider: "taobao"; mode: "phone_assisted"; evidenceSource: "user_confirmed";
  phoneOS: "android" | "ios"; accountLabel: string; store: string; itemIds: string[];
  status: "awaiting_baseline" | "selecting" | "ready_to_add" | "awaiting_reconciliation" | "needs_review" | "review_ready" | "cancelled";
  baseline: CartRow[] | null; latestCart: CartRow[] | null; selections: Selection[]; steps: CartStep[];
  budgetCents: number | null; estimatedAddedCents: number | null; issues: string[];
  events: Array<{type: string; createdAt: string}>; createdAt: string; updatedAt: string;
}
const key = (row: CartRow) => JSON.stringify([row.store, row.title, row.specification]);
function integer(value: unknown, label: string, max = 100): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw new ShoppingError(`${label}必须是 1–${max} 的整数。`);
  return value as number;
}
function price(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000_000) throw new ShoppingError("价格必须是非负整数分。");
  return value as number;
}
function row(value: unknown): CartRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShoppingError("购物车行格式无效。");
  const input = value as Record<string, unknown>;
  return {store: text(input.store,"门店",100), title: text(input.title,"商品名称",150), specification: text(input.specification,"规格",150), quantity: integer(input.quantity,"件数"), priceCents: price(input.priceCents)};
}
export function cartSnapshot(value: unknown): CartRow[] {
  if (!Array.isArray(value) || value.length > 100) throw new ShoppingError("请提供完整购物车，最多 100 行。");
  const rows = value.map(row);
  if (new Set(rows.map(key)).size !== rows.length) throw new ShoppingError("同门店同商品同规格应合并为一行，避免重复计数。");
  return rows;
}
export function cartDiff(before: CartRow[], after: CartRow[]) {
  const left = new Map(before.map(r => [key(r),r])), right = new Map(after.map(r => [key(r),r]));
  return [...new Set([...left.keys(), ...right.keys()])].map(k => {
    const a = left.get(k), b = right.get(k);
    return {product: b ?? a!, before: a?.quantity ?? 0, after: b?.quantity ?? 0, delta: (b?.quantity ?? 0) - (a?.quantity ?? 0)};
  }).filter(r => r.delta !== 0);
}
function save(experiment: CartExperiment, event: string) {
  experiment.updatedAt = new Date().toISOString(); experiment.version++;
  experiment.events.push({type:event, createdAt:experiment.updatedAt});
  getDatabase().prepare("UPDATE shopping_cart_experiments SET payload_json=?,status=?,version=?,updated_at=? WHERE user_id=? AND id=?")
    .run(JSON.stringify(experiment),experiment.status,experiment.version,experiment.updatedAt,experiment.userId,experiment.id);
  return experiment;
}
export function getCartExperiment(userId: string, id: string): CartExperiment {
  const record = getDatabase().prepare("SELECT payload_json FROM shopping_cart_experiments WHERE user_id=? AND id=?").get(userId,id) as {payload_json:string} | undefined;
  if (!record) throw new ShoppingError("找不到本用户的选购实验。",404);
  return JSON.parse(record.payload_json);
}
export function listCartExperiments(userId: string): CartExperiment[] {
  return (getDatabase().prepare("SELECT payload_json FROM shopping_cart_experiments WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 20").all(userId) as {payload_json:string}[]).map(r => JSON.parse(r.payload_json));
}
export function createCartExperiment(userId: string, input: Record<string,unknown>): CartExperiment {
  return getDatabase().transaction(() => {
    const task = getShoppingTask(userId,text(input.taskId,"采购任务 ID",100));
    if (task.provider !== "taobao") throw new ShoppingError("本轮实验只支持淘宝闪购手机 App。");
    if (task.version !== input.expectedTaskVersion) throw new WebWriteConflictError("采购任务已变化，请刷新后创建实验。");
    if (input.phoneOS !== "android" && input.phoneOS !== "ios") throw new ShoppingError("请选择实际使用的手机系统。");
    const ids = input.itemIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => !task.items.some(i => i.id === id && i.status === "pending"))) throw new ShoppingError("请选择 1–3 个待买条目；真实验收需要覆盖 3 类食材。");
    const open = getDatabase().prepare("SELECT 1 FROM shopping_cart_experiments WHERE user_id=? AND task_id=? AND status NOT IN ('cancelled','review_ready')").get(userId,task.id);
    if (open) throw new ShoppingError("该任务已有未结束的选购实验，请先核对或取消。");
    const now = new Date().toISOString();
    const experiment: CartExperiment = {id:randomUUID(),userId,taskId:task.id,taskVersion:task.version,version:1,provider:"taobao",mode:"phone_assisted",evidenceSource:"user_confirmed",phoneOS:input.phoneOS,
      accountLabel:text(input.accountLabel,"账号代号（不要填手机号）",50),store:text(input.store,"目标门店",100),itemIds:ids as string[],status:"awaiting_baseline",baseline:null,latestCart:null,selections:[],steps:[],budgetCents:input.budgetCents == null ? null : integer(input.budgetCents,"新增商品预算（分）",100_000_000),estimatedAddedCents:null,issues:[],events:[{type:"created_phone_assisted",createdAt:now}],createdAt:now,updatedAt:now};
    getDatabase().prepare("INSERT INTO shopping_cart_experiments(user_id,id,task_id,status,version,payload_json,updated_at) VALUES (?,?,?,?,?,?,?)").run(userId,experiment.id,task.id,experiment.status,experiment.version,JSON.stringify(experiment),now);
    return experiment;
  })();
}
export function changeCartExperiment(userId: string, id: string, action: string, input: Record<string, unknown>): CartExperiment {
  return getDatabase().transaction(() => {
    const exp = getCartExperiment(userId,id);
    if (input.expectedVersion !== exp.version) throw new WebWriteConflictError("选购实验已变化，请刷新核对。");
    if (action === "cancel") { if (exp.status === "cancelled") return exp; exp.status = "cancelled"; exp.issues = ["只结束本地实验，不删除或撤销手机购物车中的商品。请本人核对购物车。"]; return save(exp,"cancelled_local_only"); }
    const task = getShoppingTask(userId,exp.taskId);
    if (task.version !== exp.taskVersion) throw new WebWriteConflictError("采购任务已变化，本次实验停止，请核对后重新创建。");
    if (Date.now() - Date.parse(exp.updatedAt) > 30 * 60_000) throw new WebWriteConflictError("实验闲置超过 30 分钟，请本人核对购物车并重新创建实验。");
    if (["cancelled","review_ready"].includes(exp.status)) throw new ShoppingError("本实验已结束，不能继续加购记录。");
    if (input.contextConfirmed !== true) throw new ShoppingError("请确认手机仍为同一账号和目标门店。");
    if (action === "baseline") {
      if (exp.status !== "awaiting_baseline") throw new ShoppingError("购物车基线不能覆盖，请重新创建实验。");
      if (input.completeCartConfirmed !== true) throw new ShoppingError("请完整核对全部门店购物车，空车也需明确确认。");
      exp.baseline = cartSnapshot(input.cart); exp.latestCart = exp.baseline; exp.status = "selecting";
      return save(exp,"baseline_user_confirmed");
    }
    if (action === "select") {
      if (exp.status !== "selecting") throw new ShoppingError("加购准备已生成，不能修改商品规格。");
      if (!exp.itemIds.includes(input.itemId as string) || input.specificationConfirmed !== true || input.availableConfirmed !== true) throw new ShoppingError("请核对清单条目、商品规格和当前可售状态后选择。");
      const selection: Selection = {...row(input),itemId:input.itemId as string,specificationConfirmed:true,availableConfirmed:true};
      if (selection.store !== exp.store) throw new ShoppingError("候选商品与目标门店不一致。");
      if (exp.selections.some(s => s.itemId !== selection.itemId && key(s) === key(selection))) throw new ShoppingError("两个采购条目对应同一商品，请先合并需求，避免重复加购。");
      exp.selections = [...exp.selections.filter(s => s.itemId !== selection.itemId),selection];
      return save(exp,"selection_user_confirmed");
    }
    if (action === "prepare") {
      if (exp.status !== "selecting" || exp.selections.length !== exp.itemIds.length || !exp.baseline) throw new ShoppingError("请先完整记录购物车并为每个条目核对商品。");
      exp.steps = exp.selections.map(s => {
        const existing = exp.baseline!.find(r => key(r) === key(s))?.quantity ?? 0;
        const addQuantity = Math.max(0,s.quantity - existing);
        return {id:randomUUID(),itemId:s.itemId,product:s,addQuantity,status:addQuantity ? "pending" : "confirmed"};
      });
      exp.estimatedAddedCents = exp.steps.some(s => s.addQuantity && s.product.priceCents === null) ? null : exp.steps.reduce((sum,s) => sum + s.addQuantity * (s.product.priceCents ?? 0),0);
      if (exp.budgetCents !== null && (exp.estimatedAddedCents === null || exp.estimatedAddedCents > exp.budgetCents)) throw new ShoppingError("新增商品价格未知或超过预算，请重新核对规格、件数和价格。");
      exp.status = exp.steps.every(s => s.status === "confirmed") ? "review_ready" : "ready_to_add";
      return save(exp,"manual_steps_prepared");
    }
    if (action === "begin-step") {
      if (exp.status !== "ready_to_add") throw new ShoppingError("尚有未核对的加购结果，不能重复或继续操作。");
      const step = exp.steps.find(s => s.status === "pending");
      if (!step || input.stepId !== step.id) throw new ShoppingError("请按顺序执行下一项。");
      if (input.completeCartConfirmed !== true || cartDiff(exp.latestCart!,cartSnapshot(input.cart)).length) throw new ShoppingError("加购前购物车与最近记录不一致，停止操作并重新核对。");
      step.status = "awaiting_reconciliation"; step.startedAt = new Date().toISOString(); exp.status = "awaiting_reconciliation";
      return save(exp,"manual_step_registered_before_phone_action");
    }
    const step = exp.steps.find(s => ["awaiting_reconciliation","unknown"].includes(s.status));
    if (!step || input.stepId !== step.id) throw new ShoppingError("找不到等待核对的加购步骤。");
    if (action === "unknown") { step.status = "unknown"; exp.status = "needs_review"; exp.issues = ["加购结果不明确；先核对手机购物车，不要重复点击加购。"]; return save(exp,"outcome_unknown_do_not_retry"); }
    if (action === "reconcile") {
      if (input.completeCartConfirmed !== true) throw new ShoppingError("请完整核对加购后的全部购物车。");
      const after = cartSnapshot(input.cart), differences = cartDiff(exp.latestCart!,after);
      const expected = differences.find(r => key(r.product) === key(step.product));
      const issues: string[] = [];
      if (expected?.delta !== step.addQuantity) issues.push("所选商品的新增件数与计划不一致。");
      if (differences.some(r => key(r.product) !== key(step.product))) issues.push("其他商品发生变化，可能有误加、移除或其他端操作；请本人核对。");
      const actual = after.find(r => key(r) === key(step.product));
      if (actual?.priceCents == null || actual.priceCents !== step.product.priceCents) issues.push("所选商品单价变化或未知，请重新核对。");
      exp.latestCart = after; exp.issues = issues;
      step.status = issues.length ? "mismatch" : "confirmed";
      exp.status = issues.length ? "needs_review" : exp.steps.every(s => s.status === "confirmed") ? "review_ready" : "ready_to_add";
      return save(exp,issues.length ? "cart_difference_requires_review" : "cart_difference_user_confirmed");
    }
    throw new ShoppingError("不支持的选购实验操作。",404);
  })();
}
