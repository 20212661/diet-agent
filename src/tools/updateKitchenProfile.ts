import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  burners: Type.Optional(Type.Number({ description: "可用灶台数量" } as const)),
  hasOven: Type.Optional(Type.Boolean({ description: "是否有烤箱" } as const)),
  cookware: Type.Optional(Type.Array(Type.String(), { description: "锅具/厨具列表" } as const)),
  maxActiveMinutes: Type.Optional(Type.Number({ description: "希望控制的主动操作分钟数" } as const)),
  maxTotalMinutes: Type.Optional(Type.Number({ description: "可接受总耗时分钟数" } as const)),
  tastePreferences: Type.Optional(Type.Array(Type.String(), { description: "口味偏好" } as const)),
  cookingPreferences: Type.Optional(Type.Array(Type.String(), { description: "做饭偏好，如少洗碗、少油烟" } as const)),
});

type ParamsType = Static<typeof Params>;

export const updateKitchenProfileTool: ToolDefinition<typeof Params> = defineTool({
  name: "update_kitchen_profile",
  label: "更新厨房画像",
  description:
    "记录用户的厨房条件、厨具、可接受做饭时长和口味偏好。用户提到两个锅、烤箱、灶台、做饭时间、少洗碗、少油烟等信息时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const { userId, ...patch } = params;
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    );
    const profile = store.upsertKitchenProfile(userId, filtered);

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "已更新厨房画像：",
            `- 灶台：${profile.burners} 个`,
            `- 烤箱：${profile.hasOven ? "有" : "没有"}`,
            `- 厨具：${profile.cookware.join("、") || "未记录"}`,
            `- 主动操作目标：${profile.maxActiveMinutes} 分钟`,
            `- 总耗时上限：${profile.maxTotalMinutes} 分钟`,
            `- 口味偏好：${profile.tastePreferences.join("、") || "未记录"}`,
            `- 做饭偏好：${profile.cookingPreferences.join("、") || "未记录"}`,
          ].join("\n"),
        },
      ],
      details: profile,
    };
  },
});
