/**
 * get_user_profile 工具 - 查询用户饮食画像
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
});

type ParamsType = Static<typeof Params>;

export const getUserProfileTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_user_profile",
  label: "查询用户画像",
  description:
    "查询用户的饮食目标、身高体重、忌口、过敏等画像信息。当用户问 '我的目标是什么 / 你记得我的忌口吗 / 我的饮食画像' 等时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const profile = store.getUserProfile(params.userId);

    if (!profile) {
      return {
        content: [
          {
            type: "text" as const,
            text: "📋 暂无你的饮食画像。你可以告诉我你的目标（减脂/增肌/维持等）、身高体重、忌口、过敏等信息，我会帮你记录下来。",
          },
        ],
        details: null,
      };
    }

    const goalLabel: Record<string, string> = {
      fat_loss: "减脂",
      muscle_gain: "增肌",
      maintain: "维持体重",
      healthier_eating: "更健康饮食",
      custom: "自定义目标",
    };

    const lines = ["📋 你的饮食画像："];
    if (profile.goal) lines.push(`  目标: ${goalLabel[profile.goal] ?? profile.goal}`);
    if (profile.customGoal) lines.push(`  自定义目标: ${profile.customGoal}`);
    if (profile.heightCm) lines.push(`  身高: ${profile.heightCm} cm`);
    if (profile.weightKg) lines.push(`  体重: ${profile.weightKg} kg`);
    if (profile.age) lines.push(`  年龄: ${profile.age}`);
    if (profile.gender) lines.push(`  性别: ${profile.gender}`);
    if (profile.activityLevel) lines.push(`  活动水平: ${profile.activityLevel}`);
    if (profile.avoidFoods && profile.avoidFoods.length > 0)
      lines.push(`  忌口: ${profile.avoidFoods.join("、")}`);
    if (profile.preferences && profile.preferences.length > 0)
      lines.push(`  偏好: ${profile.preferences.join("、")}`);
    if (profile.allergies && profile.allergies.length > 0)
      lines.push(`  过敏: ${profile.allergies.join("、")}`);
    if (profile.medicalNotes && profile.medicalNotes.length > 0)
      lines.push(`  健康备注: ${profile.medicalNotes.join("、")}`);

    lines.push(`\n更新时间: ${profile.updatedAt}`);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: profile,
    };
  },
});
