/**
 * log_meal 工具 - 记录用户某一餐吃了什么
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

// ---- 参数 Schema ----
const MealFoodSchema = Type.Object({
  name: Type.String({ description: "食物名称" }),
  amount: Type.String({ description: "食用量，如 '1个'、'200ml'" }),
  estimatedCalories: Type.Optional(
    Type.Number({ description: "粗略估算热量（kcal），未估算可省略" } as const)
  ),
  note: Type.Optional(Type.String({ description: "备注" } as const)),
});

const LogMealParams = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
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
export const logMealTool: ToolDefinition<typeof LogMealParams> = defineTool({
  name: "log_meal",
  label: "记录饮食",
  description:
    "记录用户某一餐吃了什么。当用户提到 '我吃了 / 今天吃了 / 早餐 / 午餐 / 晚餐 / 加餐' 等描述时调用此工具。",
  parameters: LogMealParams,
  async execute(
    _toolCallId: string,
    params: LogMealParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const { userId, mealType, foods, note } = params;

    const mealLog = store.addMealLog({ userId, mealType, foods, note });

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
    const hasAnyCal = foods.some((f) => f.estimatedCalories != null && f.estimatedCalories > 0);
    const calNote = hasAnyCal
      ? ""
      : "\n⚠️ 当前热量为粗略估算或未估算，仅供参考。";

    const resultText = [
      `✅ 已记录${mealTypeLabel[mealType] ?? mealType}：${foodDesc}`,
      `记录 ID: ${mealLog.id}`,
      calNote,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: resultText }],
      details: mealLog,
    };
  },
});
