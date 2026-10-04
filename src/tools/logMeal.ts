/**
 * log_meal 工具 - 记录用户某一餐吃了什么
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { isValidIsoDate } from "../utils/date.js";
import { getActiveUserMessage, hasAmbiguousMealDate } from "../utils/userTurnContext.js";
import { isTraceableNutrition } from "../nutrition/nutritionEstimate.js";

// ---- 参数 Schema ----
const MealFoodSchema = Type.Object({
  name: Type.String({ description: "食物名称" }),
  amount: Type.String({ minLength: 1, description: "食用量，如 '1个'、'200ml'；信息不清时先追问，不得填未注明" }),
  nutrition: Type.Optional(Type.Object({
    status: Type.Union([Type.Literal("verified"), Type.Literal("range"), Type.Literal("unavailable")]),
    calories: Type.Optional(Type.Number({ minimum: 0 })),
    lowerCalories: Type.Optional(Type.Number({ minimum: 0 })),
    upperCalories: Type.Optional(Type.Number({ minimum: 0 })),
    foodName: Type.String({ minLength: 1 }), amount: Type.Number({ exclusiveMinimum: 0 }),
    unit: Type.String({ minLength: 1 }), grams: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    cookingMethod: Type.String({ minLength: 1 }), source: Type.String({ minLength: 1 }),
    sourceRecordId: Type.String({ minLength: 1 }), sourceVersion: Type.String({ minLength: 1 }),
  }, { additionalProperties: false })),
  note: Type.Optional(Type.String({ description: "备注" } as const)),
});

const LogMealParams = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  operationId: Type.Optional(Type.String({ minLength: 1, description: "同一写入重试时保持不变的幂等操作 ID" } as const)),
  date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "用餐日期 YYYY-MM-DD，未提供时表示今天" } as const)),
  mealType: Type.Union([
    Type.Literal("breakfast"),
    Type.Literal("lunch"),
    Type.Literal("dinner"),
    Type.Literal("snack"),
    Type.Literal("unknown"),
  ], { description: "餐次类型" }),
  foods: Type.Array(MealFoodSchema, { description: "食物列表" }),
  note: Type.Optional(Type.String({ description: "整体备注" } as const)),
});

type LogMealParamsType = Static<typeof LogMealParams>;

// ---- 工具定义 ----
export const logMealTool: ToolDefinition<typeof LogMealParams> = defineTool<typeof LogMealParams, Record<string, unknown>>({
  name: "log_meal",
  label: "记录饮食",
  description:
    "记录用户明确说出的餐食。必须确认食物和份量；未说明份量或日期有歧义时先追问。重试同一写入时复用 operationId。",
  parameters: LogMealParams,
  async execute(
    _toolCallId: string,
    params: LogMealParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const { userId, mealType, foods, note } = params;
    const unclearAmounts = ["未注明", "未知", "不确定", "适量", "一些", "少许", "一点", "不清楚"];
    const unclearFood = foods.find((food) =>
      !food.name.trim() || !food.amount.trim() || unclearAmounts.includes(food.amount.trim())
    );
    const invalidNutrition = foods.find((food) => food.nutrition && !isTraceableNutrition(food.nutrition));
    if (invalidNutrition) {
      return {
        content: [{ type: "text" as const, text: "尚未写入饮食记录。热量信息缺少有效份量、烹饪方式或可追溯来源，请先核实；也可以省略热量只记录餐食。" }],
        details: { saved: false, clarificationRequired: true, invalidNutrition: true },
      };
    }
    if (!foods.length || unclearFood) {
      return {
        content: [{ type: "text" as const, text: "尚未写入饮食记录。请先确认食物名称和大致份量（例如 1 碗、半份或约 200 克），我再记录。" }],
        details: { saved: false, clarificationRequired: true },
      };
    }
    const activeMessage = getActiveUserMessage(userId);
    if (!params.date && hasAmbiguousMealDate(activeMessage)) {
      return {
        content: [{ type: "text" as const, text: "尚未写入饮食记录。请确认这餐的日期；如果是今天，请告诉我“今天”或具体日期。" }],
        details: { saved: false, clarificationRequired: true },
      };
    }
    const date = params.date ?? store.getTodaySummary(userId).date;
    if (!isValidIsoDate(date)) {
      return {
        content: [{ type: "text" as const, text: "尚未写入饮食记录。请提供明确的用餐日期（YYYY-MM-DD）。" }],
        details: { saved: false, clarificationRequired: true },
      };
    }

    const mealLog = store.addMealLog({
      userId, operationId: params.operationId ?? _toolCallId, date, mealType, foods, note,
    });

    const mealTypeLabel: Record<string, string> = {
      breakfast: "早餐",
      lunch: "午餐",
      dinner: "晚餐",
      snack: "加餐",
      unknown: "其他",
    };

    const foodDesc = foods
      .map((f) => `${f.name} ${f.amount}`)
      .join("、");
    const hasAnyCal = foods.some((f) => f.nutrition?.status === "verified");
    const hasNutrition = foods.some((f) => f.nutrition !== undefined);
    const calNote = hasAnyCal
      ? "\n热量信息已保留来源、份量和烹饪方式。"
      : hasNutrition
        ? "\n热量数据为范围或无法估算；来源与份量信息已保留。"
        : "\n热量未估算：当前没有可追溯的份量与来源数据。";

    const resultText = [
      `✅ 已记录${date} ${mealTypeLabel[mealType] ?? mealType}：${foodDesc}`,
      `记录 ID: ${mealLog.id}`,
      calNote,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: resultText }],
      details: { ...mealLog, saved: true },
    };
  },
});
