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
          text: summary.summaryText + (summary.estimatedTotalCalories !== undefined
            ? "\n\n热量只对应记录中的食物与克数；USDA 通用食品数据可能与具体品种、品牌或烹饪添加物有差异。"
            : "\n\n至少一项缺少可追溯热量数据，因此未显示当日热量合计。"),
        },
      ],
      details: summary,
    };
  },
});
