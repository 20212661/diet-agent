/**
 * log_cooking_feedback 工具 - 记录用户对菜谱或做饭方案的反馈
 *
 * 当用户评价某道菜、某个做饭方案、实际耗时、是否太麻烦、是否好吃、下次是否还想做时调用。
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

// ---- 参数 Schema ----
const LogCookingFeedbackParams = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  recipeId: Type.Optional(Type.String({ description: "菜谱 ID（如果知道的话）" } as const)),
  recipeName: Type.Optional(Type.String({ description: "菜谱名称（如果知道的话）" } as const)),
  rating: Type.Optional(
    Type.Number({ description: "评分 1-5，5 分最好" } as const)
  ),
  actualActiveMinutes: Type.Optional(
    Type.Number({ description: "实际主动操作时间（分钟）" } as const)
  ),
  actualTotalMinutes: Type.Optional(
    Type.Number({ description: "实际总耗时（分钟）" } as const)
  ),
  tooTiring: Type.Optional(
    Type.Boolean({ description: "是否太累/太麻烦" } as const)
  ),
  tooManyDishes: Type.Optional(
    Type.Boolean({ description: "是否需要洗太多碗" } as const)
  ),
  wouldCookAgain: Type.Optional(
    Type.Boolean({ description: "下次是否还想做/是否推荐再做" } as const)
  ),
  note: Type.Optional(
    Type.String({ description: "用户的其他评价或备注" } as const)
  ),
});

type LogCookingFeedbackParamsType = Static<typeof LogCookingFeedbackParams>;

// ---- 工具定义 ----
export const logCookingFeedbackTool: ToolDefinition<typeof LogCookingFeedbackParams> = defineTool({
  name: "log_cooking_feedback",
  label: "记录做饭反馈",
  description:
    "记录用户对某个菜谱或做饭方案的反馈。触发：用户评价某道菜好不好吃、实际耗时、是否太累/太麻烦、洗碗太多、下次是否还想做、是否推荐。",
  parameters: LogCookingFeedbackParams,
  async execute(
    _toolCallId: string,
    params: LogCookingFeedbackParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const feedback = store.addCookingFeedback({
      userId: params.userId,
      recipeId: params.recipeId,
      recipeName: params.recipeName,
      rating: params.rating,
      actualActiveMinutes: params.actualActiveMinutes,
      actualTotalMinutes: params.actualTotalMinutes,
      tooTiring: params.tooTiring,
      tooManyDishes: params.tooManyDishes,
      wouldCookAgain: params.wouldCookAgain,
      note: params.note,
    });

    // 构建确认文本，只显示已提供的字段
    const lines: string[] = ["已记录这次做饭反馈："];

    if (feedback.recipeName) {
      lines.push(`- 菜谱：${feedback.recipeName}`);
    } else if (feedback.recipeId) {
      lines.push(`- 菜谱 ID：${feedback.recipeId}`);
    }

    if (feedback.rating != null) {
      lines.push(`- 评分：${feedback.rating}/5`);
    }

    if (feedback.actualActiveMinutes != null || feedback.actualTotalMinutes != null) {
      const parts: string[] = [];
      if (feedback.actualActiveMinutes != null) parts.push(`主动 ${feedback.actualActiveMinutes} 分钟`);
      if (feedback.actualTotalMinutes != null) parts.push(`总计 ${feedback.actualTotalMinutes} 分钟`);
      lines.push(`- 实际耗时：${parts.join("，")}`);
    }

    if (feedback.tooTiring) lines.push("- 标记为：太累/太麻烦");
    if (feedback.tooManyDishes) lines.push("- 标记为：洗碗太多");

    if (feedback.wouldCookAgain === true) lines.push("- 下次是否推荐：是 ✅");
    else if (feedback.wouldCookAgain === false) lines.push("- 下次是否推荐：否 ❌");

    if (feedback.note) lines.push(`- 备注：${feedback.note}`);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: feedback,
    };
  },
});
