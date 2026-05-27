import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
});

type ParamsType = Static<typeof Params>;

export const getKitchenProfileTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_kitchen_profile",
  label: "查询厨房画像",
  description:
    "查询用户的厨房条件、厨具、可接受做饭时长、口味偏好和做饭偏好。用户问厨房配置、有什么厨具、能不能用烤箱/灶台、做饭时间限制时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const profile = store.getKitchenProfile(params.userId);
    const lines = [
      "厨房画像：",
      `- 灶台：${profile.burners} 个`,
      `- 烤箱：${profile.hasOven ? "有" : "没有"}`,
      `- 厨具：${profile.cookware.join("、") || "未记录"}`,
      `- 主动操作目标：${profile.maxActiveMinutes} 分钟`,
      `- 总耗时上限：${profile.maxTotalMinutes} 分钟`,
      `- 口味偏好：${profile.tastePreferences.join("、") || "未记录"}`,
      `- 做饭偏好：${profile.cookingPreferences.join("、") || "未记录"}`,
    ];

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: profile,
    };
  },
});
