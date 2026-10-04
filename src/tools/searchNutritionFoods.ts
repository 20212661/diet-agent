import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { searchNutritionCatalog } from "../nutrition/nutritionCatalog.js";

const Params = Type.Object({
  query: Type.String({ minLength: 2, maxLength: 100, description: "中文别名或 USDA FoodData Central 英文食品名称关键词" }),
});
type ParamsType = Static<typeof Params>;

export const searchNutritionFoodsTool: ToolDefinition<typeof Params> = defineTool({
  name: "search_nutrition_foods",
  label: "搜索热量目录",
  description: "在本地 USDA SR Legacy 目录中搜索单一食物候选，展示官方食品名称、烹饪形态、FDC ID 和每 100 克热量；只能用返回的精确名称继续核算，不要把复合菜映射为单一食材。",
  parameters: Params,
  async execute(_toolCallId: string, params: ParamsType) {
    const entries = searchNutritionCatalog(params.query, 12);
    if (!entries.length) {
      return {
        content: [{ type: "text" as const, text: `目录中没有匹配“${params.query}”的食品记录。请确认食物和烹饪形态；不要自行推算热量。` }],
        details: { matched: false, results: [] },
      };
    }

    const results = entries.map((entry) => ({
      foodName: entry.nameZh ?? entry.fdcDescription,
      fdcDescription: entry.fdcDescription,
      fdcId: entry.fdcId,
      cookingMethod: entry.cookingMethod,
      caloriesPer100g: entry.caloriesPer100g,
    }));
    return {
      content: [{
        type: "text" as const,
        text: [
          `找到 ${results.length} 个目录候选。根据食品形态选择一个精确记录；若无法确认，不要估热量。`,
          ...results.map((item, index) => `${index + 1}. ${item.foodName} | 原始描述 ${item.fdcDescription} | ${item.caloriesPer100g} kcal/100g | FDC ${item.fdcId}`),
        ].join("\n"),
      }],
      details: { matched: true, results },
    };
  },
});
