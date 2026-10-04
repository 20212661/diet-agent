/**
 * get_ingredient_inventory 工具 - 查询用户食材库存
 *
 * 让模型能主动查询库存，了解用户有哪些食材、存储位置、过期状态等。
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { isAvailable, type IngredientItem } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  filter: Type.Optional(
    Type.Union([
      Type.Literal("available"),
      Type.Literal("expiring_soon"),
      Type.Literal("all"),
    ], { description: "筛选条件：available=仅可用、expiring_soon=快过期、all=全部" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

const categoryLabel: Record<string, string> = {
  protein: "🥩蛋白质", vegetable: "🥬蔬菜", staple: "🍚主食",
  seasoning: "🧂调味", dairy: "🥛乳制品", fruit: "🍎水果", other: "📦其他",
};
const storageLabel: Record<string, string> = {
  fridge: "冷藏", freezer: "冷冻", pantry: "储藏室", room_temp: "室温",
};
const statusLabel: Record<string, string> = {
  available: "可", planned: "计划", used: "已用", expired: "过期", discarded: "丢弃",
};

function formatItem(item: IngredientItem): string {
  const parts: string[] = [];
  if (item.amount) parts.push(item.amount);
  if (item.storage) parts.push(storageLabel[item.storage] ?? item.storage);
  if (item.expiresAt) {
    const prefix = item.isExpired ? "已过期：" : item.expiresSoon ? "⚠️" : "";
    parts.push(`${prefix}${item.expiresAt}`);
  }
  if (item.note) parts.push(item.note);
  return `${item.name}${parts.length > 0 ? "（" + parts.join("，") + "）" : ""}`;
}

export const getIngredientInventoryTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_ingredient_inventory",
  label: "查询食材库存",
  description:
    "查询用户的食材库存，包括存储位置、过期日期、状态等。用户问'我还有什么菜''冰箱里有什么''什么快过期了'时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const inventory = store.getIngredientInventory(params.userId);
    const filter = params.filter ?? "available";

    let available: IngredientItem[];
    if (filter === "expiring_soon") {
      available = inventory.availableIngredients.filter((item) => isAvailable(item) && item.expiresSoon);
    } else if (filter === "available") {
      available = inventory.availableIngredients.filter(isAvailable);
    } else {
      available = [...inventory.availableIngredients, ...inventory.shoppingList];
    }

    const lines: string[] = [];

    if (available.length === 0) {
      lines.push(filter === "expiring_soon"
        ? "没有快过期的食材。"
        : "暂无食材记录。");
    } else {
      // 按 category 分组显示
      const grouped = new Map<string, IngredientItem[]>();
      for (const item of available) {
        const cat = item.category || "other";
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(item);
      }

      for (const [cat, items] of grouped) {
        lines.push(`${categoryLabel[cat] ?? cat}：`);
        for (const item of items) {
          lines.push(`  - ${formatItem(item)}`);
        }
      }
    }

    // 快过期提醒
    const expiringSoon = inventory.availableIngredients.filter((item) => isAvailable(item) && item.expiresSoon);
    if (expiringSoon.length > 0 && filter !== "expiring_soon") {
      lines.push("");
      lines.push(`⚠️ 快过期食材（3天内）：${expiringSoon.map((i) => `${i.name}(${i.expiresAt})`).join("、")}`);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: inventory,
    };
  },
});
