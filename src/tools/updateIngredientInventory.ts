import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { isAvailable, type IngredientItem } from "../types/diet.js";
import { isValidIsoDate } from "../utils/date.js";

// 结构化食材 Schema
const IngredientItemSchema = Type.Object({
  id: Type.Optional(Type.String({ description: "食材记录 ID" } as const)),
  name: Type.String({ description: "食材名称" }),
  amount: Type.Optional(Type.String({ description: "数量，如 '4个'、'500g'" } as const)),
  unit: Type.Optional(Type.String({ description: "单位" } as const)),
  category: Type.Optional(
    Type.Union([
      Type.Literal("protein"), Type.Literal("vegetable"), Type.Literal("staple"),
      Type.Literal("seasoning"), Type.Literal("dairy"), Type.Literal("fruit"), Type.Literal("other"),
    ], { description: "食材分类" } as const)
  ),
  storage: Type.Optional(
    Type.Union([
      Type.Literal("fridge"), Type.Literal("freezer"), Type.Literal("pantry"), Type.Literal("room_temp"),
    ], { description: "存储位置" } as const)
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal("available"), Type.Literal("planned"), Type.Literal("used"),
      Type.Literal("expired"), Type.Literal("discarded"),
    ], { description: "状态" } as const)
  ),
  expiresAt: Type.Optional(Type.String({ description: "过期日期 YYYY-MM-DD" } as const)),
  purchasedAt: Type.Optional(Type.String({ description: "购买日期 YYYY-MM-DD" } as const)),
  note: Type.Optional(Type.String({ description: "备注" } as const)),
});

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  availableIngredients: Type.Optional(Type.Array(Type.String(), { description: "家里已有食材（简单字符串）" } as const)),
  availableItems: Type.Optional(Type.Array(IngredientItemSchema, { description: "家里已有食材（结构化）" } as const)),
  shoppingList: Type.Optional(Type.Array(Type.String(), { description: "需要购买的食材（简单字符串）" } as const)),
  shoppingItems: Type.Optional(Type.Array(IngredientItemSchema, { description: "需要购买的食材（结构化）" } as const)),
  replaceAvailable: Type.Optional(Type.Boolean({ description: "是否替换已有食材列表，默认追加" } as const)),
  replaceShoppingList: Type.Optional(Type.Boolean({ description: "是否替换购物清单，默认追加" } as const)),
});

type ParamsType = Static<typeof Params>;

function formatItem(item: IngredientItem): string {
  const parts: string[] = [item.name];
  if (item.amount) parts.push(item.amount);
  if (item.storage) {
    const labels: Record<string, string> = { fridge: "冷藏", freezer: "冷冻", pantry: "储藏室", room_temp: "室温" };
    parts.push(labels[item.storage] ?? item.storage);
  }
  if (item.category) {
    const labels: Record<string, string> = { protein: "蛋白质", vegetable: "蔬菜", staple: "主食", seasoning: "调味", dairy: "乳制品", fruit: "水果", other: "其他" };
    parts.push(labels[item.category] ?? item.category);
  }
  if (item.expiresAt) parts.push(`${item.expiresSoon ? "⚠️" : ""}${item.expiresAt}到期`);
  if (item.status && item.status !== "available") {
    const labels: Record<string, string> = { used: "已用", expired: "已过期", discarded: "已丢弃", planned: "计划中" };
    parts.push(labels[item.status] ?? item.status);
  }
  return parts.join("｜");
}

export const updateIngredientInventoryTool: ToolDefinition<typeof Params> = defineTool({
  name: "update_ingredient_inventory",
  label: "更新食材库存",
  description:
    "记录现有食材和购物清单。支持简单字符串和结构化输入（带数量、存储位置、过期日期等）。用户说'我有...'、'冰箱里有...'、'冷冻了...'、'今天买...'、'XX号到期'时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    // 拆分字符串和结构化输入
    const availableStrings = params.availableIngredients ?? [];
    const availableStructured = (params.availableItems ?? []) as IngredientItem[];
    const shoppingStrings = params.shoppingList ?? [];
    const shoppingStructured = (params.shoppingItems ?? []) as IngredientItem[];
    for (const item of [...availableStructured, ...shoppingStructured]) {
      if ((item.expiresAt && !isValidIsoDate(item.expiresAt)) || (item.purchasedAt && !isValidIsoDate(item.purchasedAt))) {
        throw new Error("食材日期必须是有效的 YYYY-MM-DD 日期。");
      }
    }

    const inventory = store.upsertIngredientInventory(params.userId, {
      availableIngredients: availableStrings.length > 0 ? availableStrings : availableStructured.length > 0 ? availableStructured : undefined,
      shoppingList: shoppingStrings.length > 0 ? shoppingStrings : shoppingStructured.length > 0 ? shoppingStructured : undefined,
      replaceAvailable: params.replaceAvailable,
      replaceShoppingList: params.replaceShoppingList,
    });

    const available = inventory.availableIngredients
      .filter(isAvailable)
      .map(formatItem)
      .join("\n  ") || "暂无";
    const shopping = inventory.shoppingList
      .filter((item) => item.status === "available" || item.status === "planned" || !item.status)
      .map(formatItem)
      .join("\n  ") || "暂无";

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "已更新食材信息：",
            `现有食材：\n  ${available}`,
            `购物清单：\n  ${shopping}`,
          ].join("\n"),
        },
      ],
      details: inventory,
    };
  },
});
