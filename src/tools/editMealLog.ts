import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { isValidIsoDate } from "../utils/date.js";
import { isTraceableNutrition } from "../nutrition/nutritionEstimate.js";

const Food = Type.Object({
  name: Type.String({ minLength: 1 }),
  amount: Type.String({ minLength: 1 }),
  nutrition: Type.Optional(Type.Any()),
  note: Type.Optional(Type.String()),
});
const Params = Type.Object({
  userId: Type.String(),
  mealLogId: Type.String({ minLength: 1, description: "get_today_summary 返回的记录 ID" }),
  operationId: Type.Optional(Type.String({ minLength: 1, description: "同一修改重试时保持不变" } as const)),
  date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  mealType: Type.Optional(Type.Union([
    Type.Literal("breakfast"), Type.Literal("lunch"), Type.Literal("dinner"), Type.Literal("snack"), Type.Literal("unknown"),
  ])),
  foods: Type.Optional(Type.Array(Food, { minItems: 1 })),
  note: Type.Optional(Type.String()),
}, { minProperties: 3 });
type ParamsType = Static<typeof Params>;

export const editMealLogTool: ToolDefinition<typeof Params> = defineTool<typeof Params, Record<string, unknown>>({
  name: "edit_meal_log",
  label: "更正饮食记录",
  description: "用户明确指出哪条已存在的饮食记录及要更正的字段后调用。先用 get_today_summary 获取记录 ID。补充新食物或用户补充份量时立即更新：仍不明的份量填'未注明'先落库，再在回复里追问。注意 foods 是整条记录的完整食物列表（含原有项），不是增量。",
  parameters: Params,
  async execute(
    toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext,
  ) {
    const { userId, mealLogId, operationId, ...patch } = params;
    // 与 log_meal 同策略：份量模糊词规范化为"未注明"先落库，只拦食物名缺失。
    const vagueAmounts = ["未知", "不确定", "适量", "一些", "少许", "一点", "不清楚", "没说", ""];
    if (patch.foods) {
      patch.foods = patch.foods.map((food) => ({
        ...food,
        amount: vagueAmounts.includes(food.amount.trim()) ? "未注明" : food.amount,
      }));
    }
    if (patch.foods?.some((food) => !food.name.trim())) {
      return {
        content: [{ type: "text" as const, text: "尚未更正。请提供每项食物的名称；份量不清楚可填'未注明'先更新。" }],
        details: { saved: false, clarificationRequired: true },
      };
    }
    if (patch.foods?.some((food) => food.nutrition !== undefined && !isTraceableNutrition(food.nutrition))) {
      return {
        content: [{ type: "text" as const, text: "尚未更正。热量信息缺少有效份量、烹饪方式或可追溯来源；请核实或移除热量信息。" }],
        details: { saved: false, clarificationRequired: true, invalidNutrition: true },
      };
    }
    if (patch.date) {
      if (!isValidIsoDate(patch.date)) {
        return {
          content: [{ type: "text" as const, text: "尚未更正。请提供明确有效的日期（YYYY-MM-DD）。" }],
          details: { saved: false, clarificationRequired: true },
        };
      }
    }
    const entry = store.updateMealLog({ userId, mealLogId, operationId: operationId ?? toolCallId, ...patch });
    if (!entry) {
      return {
        content: [{ type: "text" as const, text: "没有找到这条属于当前用户的饮食记录，请先查询记录 ID。" }],
        details: { saved: false, notFound: true },
      };
    }
    return {
      content: [{ type: "text" as const, text: `✅ 已更正记录 ${entry.id}：${entry.date} ${entry.foods.map((food) => `${food.name} ${food.amount}`).join("、")}` }],
      details: { ...entry, saved: true },
    };
  },
});
