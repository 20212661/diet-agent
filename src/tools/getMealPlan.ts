import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { todayDate } from "../store/shared.js";
import { isValidIsoDate } from "../utils/date.js";
import type { MealType } from "../types/diet.js";
import type { MealPlan, MealPlanDay } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  date: Type.Optional(Type.String({ description: "查询日期 YYYY-MM-DD，默认今天" } as const)),
});
type ParamsType = Static<typeof Params>;
interface MealPlanLookupDetails {
  userId: string;
  date: string;
  found: boolean;
  plan?: MealPlan;
  day?: MealPlanDay;
}

const LABELS: Record<Exclude<MealType, "unknown">, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

export const getMealPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_meal_plan",
  label: "查看饮食计划",
  description: "查看指定日期（默认今天）已保存的一日或多日饮食计划。",
  parameters: Params,
  async execute(_toolCallId: string, params: ParamsType, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: ExtensionContext) {
    if (params.date !== undefined && !isValidIsoDate(params.date)) {
      throw new Error("date 必须是有效的 YYYY-MM-DD 日期。");
    }
    const date = params.date ?? todayDate();
    const plan = store.getMealPlan(params.userId, date);
    const day = plan?.days.find((candidate) => candidate.date === date);
    if (!plan || !day) {
      return {
        content: [{ type: "text" as const, text: `${date} 还没有保存的饮食计划。可以让我按你的目标、库存和时间安排一份。` }],
        details: { userId: params.userId, date, found: false } as MealPlanLookupDetails,
      };
    }

    const lines = [`## 饮食计划（${date}）`];
    if (plan.target) lines.push(`目标：${plan.target}`);
    if (plan.constraints?.temporaryAvoidFoods.length) lines.push(`本次临时避开：${plan.constraints.temporaryAvoidFoods.join("、")}`);
    if (plan.constraints) lines.push(`主动操作上限：每餐 ${plan.constraints.timeLimitMinutes} 分钟；精力：${plan.constraints.energyLevel === "low" ? "低能量" : "正常"}`);
    for (const meal of day.meals) {
      if (meal.executionBlockedReason) {
        lines.push(`- ${LABELS[meal.mealType]}：需重新安排。${meal.executionBlockedReason}`);
        continue;
      }
      const detail = meal.activeMinutes === undefined ? "" : `（主动 ${meal.activeMinutes} 分钟${meal.totalMinutes ? `，总计 ${meal.totalMinutes} 分钟` : ""}）`;
      lines.push(`- ${LABELS[meal.mealType]}：${meal.name}${detail}`);
      if (meal.missingIngredients.length) lines.push(`  - 需准备：${meal.missingIngredients.join("、")}`);
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { userId: params.userId, date, found: true, plan, day } as MealPlanLookupDetails,
    };
  },
});
