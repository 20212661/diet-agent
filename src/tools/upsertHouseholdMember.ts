/**
 * upsert_household_member 工具 - 新增/更新家庭成员（确认后写入）
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import type { HouseholdMemberPatch } from "../store/repositories/householdMemberRepository.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  memberId: Type.Optional(
    Type.String({ description: "要更新的成员 ID（来自 get_household_members）；新增成员时不传" } as const)
  ),
  name: Type.Optional(Type.String({ maxLength: 24, description: "成员名（同账号内唯一；不能用\"我\"或\"self\"）" } as const)),
  allergies: Type.Optional(
    Type.Array(Type.String(), { description: "过敏食物列表" } as const)
  ),
  avoidFoods: Type.Optional(
    Type.Array(Type.String(), { description: "忌口/不吃的食物列表" } as const)
  ),
  preferences: Type.Optional(
    Type.Array(Type.String(), { description: "口味偏好列表" } as const)
  ),
  notes: Type.Optional(Type.String({ maxLength: 200, description: "备注（如：小孩）" } as const)),
});

type ParamsType = Static<typeof Params>;

export const upsertHouseholdMemberTool: ToolDefinition<typeof Params> = defineTool<typeof Params, Record<string, unknown>>({
  name: "upsert_household_member",
  label: "新增/更新家庭成员",
  description:
    "新增或更新家庭用餐成员（名字、过敏、忌口、口味）。先向用户展示将保存的完整字段并通过确认对话框取得明确同意；取消或无确认界面时不得写入。成员名不能用\"我\"或\"self\"（主账号保留名）。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    ctx?: ExtensionContext
  ) {
    const { userId, memberId, ...patch } = params;

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) filtered[key] = value;
    }
    if (Object.keys(filtered).length === 0) {
      return {
        content: [{ type: "text" as const, text: "没有提供需要保存的成员字段。" }],
        details: { saved: false, empty: true },
      };
    }

    const existing = memberId ? store.getHouseholdMember(userId, memberId) : undefined;
    if (memberId && !existing) {
      return {
        content: [{ type: "text" as const, text: `成员不存在：${memberId}。请先调用 get_household_members 确认成员 ID。` }],
        details: { saved: false, notFound: true },
      };
    }
    // 更新未传名的场景沿用现名；新增必须有名字
    const finalName = (filtered.name as string | undefined) ?? existing?.name;
    if (!finalName) {
      return {
        content: [{ type: "text" as const, text: "新增成员需要提供成员名。" }],
        details: { saved: false, clarificationRequired: true },
      };
    }

    const labels: Record<string, string> = {
      name: "成员名", allergies: "过敏", avoidFoods: "忌口", preferences: "口味偏好", notes: "备注",
    };
    const confirmationLines = [`成员名：${finalName}${existing ? "（更新既有成员）" : "（新增成员）"}`];
    for (const [key, value] of Object.entries(filtered)) {
      if (key === "name") continue;
      confirmationLines.push(`${labels[key] ?? key}：${Array.isArray(value) ? value.join("、") : String(value)}`);
    }

    if (!ctx?.hasUI) {
      return {
        content: [{ type: "text" as const, text: `尚未保存家庭成员。请在可确认的交互界面确认以下内容后再提交：\n${confirmationLines.join("\n")}` }],
        details: { saved: false, confirmationRequired: true, proposed: filtered },
      };
    }
    const confirmed = await ctx.ui.confirm(
      existing ? "确认更新家庭成员" : "确认新增家庭成员",
      `以下信息将保存为家庭成员资料（排菜时会参与\"谁吃\"的过敏/忌口过滤）：\n\n${confirmationLines.join("\n")}`,
    );
    if (!confirmed) {
      return {
        content: [{ type: "text" as const, text: "已取消，本次没有更改家庭成员。" }],
        details: { saved: false, cancelled: true, proposed: filtered },
      };
    }

    const memberPatch: HouseholdMemberPatch & { name?: string } = { ...filtered, name: finalName };
    const saved = store.upsertHouseholdMember(userId, memberId, memberPatch);

    const warnings: string[] = [];
    if (saved.allergies.length > 0) {
      warnings.push("⚠️ 已记录该成员的食物过敏信息：排菜时会硬过滤相关食材；涉及过敏问题请咨询专业医生。");
    }

    const lines = [`✅ 家庭成员已${existing ? "更新" : "新增"}：`];
    lines.push(`  名字: ${saved.name} | memberId: ${saved.memberId}`);
    if (saved.allergies.length > 0) lines.push(`  过敏: ${saved.allergies.join("、")}`);
    if (saved.avoidFoods.length > 0) lines.push(`  忌口: ${saved.avoidFoods.join("、")}`);
    if (saved.preferences.length > 0) lines.push(`  口味: ${saved.preferences.join("、")}`);
    if (saved.notes) lines.push(`  备注: ${saved.notes}`);
    if (warnings.length > 0) lines.push("", ...warnings);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { ...saved, saved: true },
    };
  },
});
