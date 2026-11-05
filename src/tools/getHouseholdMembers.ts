/**
 * get_household_members 工具 - 查询家庭用餐成员（含"我"的虚拟投影）
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { listDiningMembers } from "../services/household.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
});

type ParamsType = Static<typeof Params>;

export const getHouseholdMembersTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_household_members",
  label: "查询家庭成员",
  description:
    "查询家庭全部用餐成员（含\"我\"的虚拟投影与其他成员）的 memberId、名字、过敏、忌口和口味。用户提到家里谁吃什么/谁过敏/排菜问\"谁吃\"时先调用本工具；排菜工具的 diningMembers 参数需要这里的 memberId 或成员名。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const members = listDiningMembers(params.userId);
    const lines = [`👨‍👩‍👧 家庭用餐成员（共 ${members.length} 人）：`];
    for (const member of members) {
      lines.push(`- ${member.name}${member.isSelf ? "（你本人）" : ""} | memberId: ${member.memberId}`);
      lines.push(`  过敏：${member.allergies.length > 0 ? member.allergies.join("、") : "无"}`);
      lines.push(`  忌口：${member.avoidFoods.length > 0 ? member.avoidFoods.join("、") : "无"}`);
      lines.push(`  口味：${member.preferences.length > 0 ? member.preferences.join("、") : "无"}`);
    }
    lines.push("");
    lines.push("排菜时：默认全部成员一起吃；用户说明某人不在/只做某些人吃的，把对应 memberId（或成员名）传给排菜工具的 diningMembers。");
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { members },
    };
  },
});
