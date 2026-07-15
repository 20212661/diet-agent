/**
 * get_today_summary 工具 - 查询用户今天已经记录的饮食
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  date: Type.Optional(
    Type.String({ description: "查询日期 YYYY-MM-DD，默认今天" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

export const getTodaySummaryTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_today_summary",
  label: "今日饮食总结",
  description:
    "查询用户今天（或指定日期）已经记录的饮食、汇总热量。当用户问 '今天吃得怎么样 / 今日总结 / 我摄入多少 / 我今天饮食如何' 等时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const summary = store.getTodaySummary(params.userId, params.date);

    return {
      content: [
        {
          type: "text" as const,
          text: summary.summaryText + "\n\n⚠️ 以上热量均为粗略估算，仅供参考。",
        },
      ],
      details: summary,
    };
  },
});
