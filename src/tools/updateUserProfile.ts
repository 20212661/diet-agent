/**
 * update_user_profile 工具 - 更新用户饮食画像
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { getActiveUserMessage, isTemporaryAvoidanceMessage } from "../utils/userTurnContext.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  goal: Type.Optional(
    Type.Union([
      Type.Literal("fat_loss"),
      Type.Literal("muscle_gain"),
      Type.Literal("maintain"),
      Type.Literal("healthier_eating"),
      Type.Literal("custom"),
    ], { description: "饮食目标" } as const)
  ),
  customGoal: Type.Optional(Type.String({ description: "自定义目标描述" } as const)),
  heightCm: Type.Optional(Type.Number({ description: "身高（厘米）" } as const)),
  weightKg: Type.Optional(Type.Number({ description: "体重（公斤）" } as const)),
  age: Type.Optional(Type.Number({ description: "年龄" } as const)),
  gender: Type.Optional(Type.String({ description: "性别" } as const)),
  activityLevel: Type.Optional(
    Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ], { description: "日常活动水平" } as const)
  ),
  avoidFoods: Type.Optional(
    Type.Array(Type.String(), { description: "忌口/不吃的食物列表" } as const)
  ),
  preferences: Type.Optional(
    Type.Array(Type.String(), { description: "偏好食物列表" } as const)
  ),
  allergies: Type.Optional(
    Type.Array(Type.String(), { description: "过敏食物列表" } as const)
  ),
  medicalNotes: Type.Optional(
    Type.Array(Type.String(), { description: "医疗/健康状况备注" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

export const updateUserProfileTool: ToolDefinition<typeof Params> = defineTool<typeof Params, Record<string, unknown>>({
  name: "update_user_profile",
  label: "更新用户画像",
  description:
    "提出饮食画像变更。先向用户展示将保存的完整字段，并通过确认对话框取得明确同意；取消或无确认界面时不得写入。临时忌口只用于当前请求，不得调用本工具。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    ctx?: ExtensionContext
  ) {
    const { userId, ...patch } = params;

    // 过滤掉 undefined 的字段
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        filtered[k] = v;
      }
    }

    const currentMessage = getActiveUserMessage(userId);
    const temporaryAvoidance = isTemporaryAvoidanceMessage(currentMessage);
    if (temporaryAvoidance) {
      delete filtered.avoidFoods;
      delete filtered.allergies;
      if (Object.keys(filtered).length === 0) {
        return {
          content: [{ type: "text" as const, text: "这是一项短期饮食要求，我不会将它保存为长期忌口或过敏信息。" }],
          details: { saved: false, temporaryAvoidance: true },
        };
      }
    }

    if (Object.keys(filtered).length === 0) {
      return {
        content: [{ type: "text" as const, text: "没有提供需要保存的画像字段。" }],
        details: { saved: false, empty: true },
      };
    }

    const confirmationLines = Object.entries(filtered).map(([key, value]) => {
      const label: Record<string, string> = {
        goal: "饮食目标", customGoal: "自定义目标", heightCm: "身高（cm）", weightKg: "体重（kg）",
        age: "年龄", gender: "性别", activityLevel: "活动水平", avoidFoods: "长期忌口",
        preferences: "长期偏好", allergies: "长期过敏信息", medicalNotes: "健康备注",
      };
      return `${label[key] ?? key}：${Array.isArray(value) ? value.join("、") : String(value)}`;
    });
    if (!ctx?.hasUI) {
      return {
        content: [{ type: "text" as const, text: `尚未保存画像。请在可确认的交互界面确认以下内容后再提交：\n${confirmationLines.join("\n")}` }],
        details: { saved: false, confirmationRequired: true, proposed: filtered },
      };
    }
    const confirmed = await ctx.ui.confirm(
      "确认保存饮食画像",
      `以下长期信息将写入你的画像：\n\n${confirmationLines.join("\n")}\n\n确认后可用于后续饮食推荐。`,
    );
    if (!confirmed) {
      return {
        content: [{ type: "text" as const, text: "已取消，本次没有更改饮食画像。" }],
        details: { saved: false, cancelled: true, proposed: filtered },
      };
    }

    const updated = store.upsertUserProfile(userId, filtered);

    // 检查是否需要健康提醒
    const warnings: string[] = [];
    if (
      updated.allergies &&
      updated.allergies.length > 0
    ) {
      warnings.push("⚠️ 你记录了食物过敏信息，涉及过敏问题时请务必咨询专业医生。");
    }
    if (
      updated.medicalNotes &&
      updated.medicalNotes.length > 0
    ) {
      warnings.push(
        "⚠️ 你记录了健康状况备注。我是饮食管理助手，不能替代医生或营养师的专业建议，如有健康疑虑请咨询专业人士。"
      );
    }

    const goalLabel: Record<string, string> = {
      fat_loss: "减脂",
      muscle_gain: "增肌",
      maintain: "维持体重",
      healthier_eating: "更健康饮食",
      custom: "自定义目标",
    };

    const lines = ["✅ 用户饮食画像已更新："];
    if (temporaryAvoidance) lines.push("  本轮短期忌口未写入长期画像。");
    if (updated.goal) lines.push(`  目标: ${goalLabel[updated.goal] ?? updated.goal}`);
    if (updated.customGoal) lines.push(`  自定义目标: ${updated.customGoal}`);
    if (updated.heightCm) lines.push(`  身高: ${updated.heightCm} cm`);
    if (updated.weightKg) lines.push(`  体重: ${updated.weightKg} kg`);
    if (updated.age) lines.push(`  年龄: ${updated.age}`);
    if (updated.gender) lines.push(`  性别: ${updated.gender}`);
    if (updated.activityLevel) lines.push(`  活动水平: ${updated.activityLevel}`);
    if (updated.avoidFoods && updated.avoidFoods.length > 0)
      lines.push(`  忌口: ${updated.avoidFoods.join("、")}`);
    if (updated.preferences && updated.preferences.length > 0)
      lines.push(`  偏好: ${updated.preferences.join("、")}`);
    if (updated.allergies && updated.allergies.length > 0)
      lines.push(`  过敏: ${updated.allergies.join("、")}`);
    if (updated.medicalNotes && updated.medicalNotes.length > 0)
      lines.push(`  健康备注: ${updated.medicalNotes.join("、")}`);

    if (warnings.length > 0) {
      lines.push("");
      lines.push(...warnings);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { ...updated, saved: true },
    };
  },
});
