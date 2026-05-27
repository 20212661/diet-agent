/**
 * mark_ingredient_used 工具 - 标记食材状态变更
 *
 * 让模型能标记食材为 已用、过期、丢弃 等状态。
 * 用户说"鸡腿用完了"、"西兰花坏了"、"扔掉XX"时调用。
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import type { IngredientItem } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  ingredientName: Type.String({ description: "食材名称（模糊匹配）" }),
  status: Type.Union(
    [
      Type.Literal("used"),
      Type.Literal("expired"),
      Type.Literal("discarded"),
      Type.Literal("available"),
    ],
    { description: "要设置的状态：used=已用完、expired=已过期、discarded=已丢弃、available=恢复可用" } as const
  ),
  note: Type.Optional(Type.String({ description: "备注说明" } as const)),
});

type ParamsType = Static<typeof Params>;

const actionLabel: Record<string, string> = {
  used: "标记为已用",
  expired: "标记为过期",
  discarded: "标记为已丢弃",
  available: "恢复为可用",
};

export const markIngredientUsedTool: ToolDefinition<typeof Params> = defineTool({
  name: "mark_ingredient_used",
  label: "标记食材状态",
  description:
    "标记食材的状态变更，如已用完、已过期、已丢弃等。用户说'XX用完了''XX坏了''扔掉XX''XX还能用'时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const result = store.updateIngredientStatus(
      params.userId,
      params.ingredientName,
      params.status,
      params.note
    );

    if (!result) {
      return {
        content: [
          {
            type: "text" as const,
            text: `未找到食材「${params.ingredientName}」，请先检查库存。`,
          },
        ],
        details: undefined as unknown as IngredientItem,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `已将「${result.name}」${actionLabel[params.status]}。`,
            params.note ? `备注：${params.note}` : "",
            result.expiresAt ? `过期日期：${result.expiresAt}` : "",
            result.expiresSoon ? "⚠️ 该食材即将过期" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      details: result as unknown as IngredientItem,
    };
  },
});
