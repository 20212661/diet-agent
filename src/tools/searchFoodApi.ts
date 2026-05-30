/**
 * search_food_api 工具 - 通过 FatSecret API 搜索食物营养信息
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as fatsecret from "../agent/fatsecret-api.js";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  query: Type.String({ description: "搜索关键词，如食材名或菜名" }),
  type: Type.Optional(
    Type.Union([Type.Literal("food"), Type.Literal("recipe")], { description: "搜索类型：food=食物营养，recipe=菜谱。默认两者都搜" } as const)
  ),
  maxResults: Type.Optional(Type.Number({ description: "返回数量，默认 5" } as const)),
});

type ParamsType = Static<typeof Params>;

export const searchFoodApiTool: ToolDefinition<typeof Params> = defineTool({
  name: "search_food_api",
  label: "在线搜索食物/菜谱",
  description:
    "通过 FatSecret API 在线搜索食物营养信息或菜谱。当用户问'XX 多少卡'、'有什么新菜谱'、内置菜谱不够用时调用。支持中文搜索。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    if (!fatsecret.isConfigured()) {
      return {
        content: [{ type: "text" as const, text: "FatSecret API 未配置。在 .env 中设置 FATSECRET_CLIENT_ID 和 FATSECRET_CLIENT_SECRET 后可用。" }],
        details: { query: params.query, error: "not_configured" },
      };
    }

    const limit = params.maxResults ?? 5;
    const type = params.type;
    const lines: string[] = [];

    if (!type || type === "food") {
      const foods = await fatsecret.searchFoods(params.query, limit);
      if (foods.length > 0) {
        lines.push("### 食物营养搜索结果");
        for (const f of foods) {
          lines.push(`- **${f.name}** (ID: ${f.foodId})`);
          if (f.description) lines.push(`  ${f.description}`);
        }

        const first = foods[0];
        const nutrition = await fatsecret.getFoodNutrition(first.foodId);
        if (nutrition) {
          lines.push(`\n**${first.name} 营养详情** (${nutrition.servingText})`);
          lines.push(`- 热量: ${nutrition.calories} kcal`);
          lines.push(`- 蛋白质: ${nutrition.protein}g │ 碳水: ${nutrition.carbs}g │ 脂肪: ${nutrition.fat}g`);
        }
      }
    }

    if (!type || type === "recipe") {
      const recipes = await fatsecret.searchRecipes(params.query, limit);
      if (recipes.length > 0) {
        lines.push("### 在线菜谱搜索结果");
        for (const r of recipes) {
          lines.push(`- **${r.name}**`);
          if (r.description) lines.push(`  ${r.description}`);
        }
      }
    }

    if (lines.length === 0) {
      lines.push(`未找到"${params.query}"的相关结果。`);
    }

    // 缓存到用户菜谱（source=api）
    const recipes = await fatsecret.searchRecipes(params.query, 3);
    for (const r of recipes) {
      const existing = store.searchUserRecipes(params.userId, r.name);
      if (existing.length === 0) {
        store.addUserRecipe({
          userId: params.userId,
          name: r.name,
          ingredients: [],
          steps: [],
          source: "api",
          tags: ["fatsecret"],
        });
      }
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { query: params.query, error: "" },
    };
  },
});
