import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createShoppingTask, getShoppingTask, listShoppingTasks } from "../shopping/shoppingService.js";
import { getShoppingProviders } from "../shopping/providers.js";
import { getIngredientInventory } from "../store/repositories/inventoryRepository.js";
import { getDatabase } from "../store/database.js";
import { executeWebWriteOnce } from "../web/writeOnce.js";

const Query = Type.Object({ userId: Type.String(), taskId: Type.Optional(Type.String()) });
export const getShoppingTasksTool = defineTool({
  name: "get_shopping_tasks", label: "查询采购任务",
  description: "查询当前用户采购任务、待购清单 ID 和版本、已验证的平台入口。状态可能为用户手动记录，不能当成平台核实的订单状态。", parameters: Query,
  async execute(_id, params) {
    const result = {tasks: params.taskId ? [getShoppingTask(params.userId, params.taskId)] : listShoppingTasks(params.userId), inventory: getIngredientInventory(params.userId), providers: getShoppingProviders(params.userId)};
    return {content: [{type: "text" as const, text: JSON.stringify(result)}], details: result};
  },
});
const Create = Type.Object({userId: Type.String(), provider: Type.Union([Type.Literal("meituan"),Type.Literal("taobao")]),
  sourceItemIds: Type.Array(Type.String(), {minItems: 1, maxItems: 100}), inventoryUpdatedAt: Type.String(), title: Type.Optional(Type.String({maxLength: 100}))});
export const createShoppingTaskTool = defineTool({
  name: "create_shopping_task", label: "创建采购草稿",
  description: "用户要求购买时，从已有待购条目创建采购草稿。先查询条目 ID 和库存版本，不代下单或付款；数量来自待购清单，不推测。", parameters: Create,
  async execute(toolCallId, params) {
    const payload = {operationId: `shopping-tool:${toolCallId}`, title: params.title ?? "食材采购", provider: params.provider,
      inventoryUpdatedAt: params.inventoryUpdatedAt, items: params.sourceItemIds.map(sourceItemId => ({sourceItemId}))};
    const task = executeWebWriteOnce(getDatabase(), params.userId, "agent:create_shopping_task", payload, () => createShoppingTask(params.userId, payload));
    return {content: [{type: "text" as const, text: `采购草稿已保存，请在库存页核对清单并去平台购买。尚未下单。\n${JSON.stringify(task)}`}], details: {saved: true, task}};
  },
});
