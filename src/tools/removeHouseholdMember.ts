/**
 * remove_household_member 工具 - 删除家庭成员（确认后写入）
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  memberId: Type.Optional(
    Type.String({ description: "要删除的成员 ID（来自 get_household_members）；与 name 二选一" } as const)
  ),
  name: Type.Optional(
    Type.String({ maxLength: 24, description: "要删除的成员名（精确匹配）；与 memberId 二选一" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

export const removeHouseholdMemberTool: ToolDefinition<typeof Params> = defineTool<typeof Params, Record<string, unknown>>({
  name: "remove_household_member",
  label: "删除家庭成员",
  description:
    "删除一个家庭用餐成员。先向用户展示成员名与资料并通过确认对话框取得明确同意；\"我\"（主账号）不是成员记录、不可删除。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    ctx?: ExtensionContext
  ) {
    const { userId, memberId, name } = params;
    const members = store.listHouseholdMembers(userId);
    const target = (memberId ? members.find((member) => member.memberId === memberId) : undefined)
      ?? (name ? members.find((member) => member.name === name) : undefined);

    if (!target) {
      return {
        content: [{ type: "text" as const, text: "没有匹配到的家庭成员。请先调用 get_household_members 确认成员列表。" }],
        details: { saved: false, notFound: true },
      };
    }

    const profile = [
      `成员名：${target.name}（memberId: ${target.memberId}）`,
      target.allergies.length > 0 ? `过敏：${target.allergies.join("、")}` : "过敏：无",
      target.avoidFoods.length > 0 ? `忌口：${target.avoidFoods.join("、")}` : "忌口：无",
      target.preferences.length > 0 ? `口味：${target.preferences.join("、")}` : "口味：无",
    ].join("\n");

    if (!ctx?.hasUI) {
      return {
        content: [{ type: "text" as const, text: `尚未删除。请在可确认的交互界面确认后再提交：\n${profile}` }],
        details: { saved: false, confirmationRequired: true },
      };
    }
    const confirmed = await ctx.ui.confirm(
      "确认删除家庭成员",
      `将删除以下家庭成员（已保存的历史计划不受影响；之后排菜不再计入该成员的过敏/忌口）：\n\n${profile}`,
    );
    if (!confirmed) {
      return {
        content: [{ type: "text" as const, text: "已取消，本次没有删除家庭成员。" }],
        details: { saved: false, cancelled: true },
      };
    }

    const removed = store.removeHouseholdMember(userId, target.memberId);
    return {
      content: [{ type: "text" as const, text: removed ? `✅ 已删除家庭成员：${target.name}。` : `未能删除成员：${target.name}。` }],
      details: { saved: removed, removedMemberId: target.memberId, removedName: target.name },
    };
  },
});
