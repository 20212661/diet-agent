import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { estimateCatalogNutrition, findNutritionCatalogEntry } from "../nutrition/nutritionCatalog.js";

const Params = Type.Object({
  foodName: Type.String({ minLength: 1, description: "食物及其生熟/烹饪状态，必须与目录名称一致" }),
  sourceRecordId: Type.Optional(Type.String({ pattern: "^\\d+$", description: "search_nutrition_foods 返回的 FDC ID，用于精确选择候选" })),
  grams: Type.Number({ exclusiveMinimum: 0, description: "用户提供或称重得到的可食部分克数；不接受碗、个、勺等单位" }),
});
type ParamsType = Static<typeof Params>;

export const estimateFoodCaloriesTool: ToolDefinition<typeof Params> = defineTool<typeof Params, Record<string, unknown>>({
  name: "estimate_food_calories",
  label: "核算食物热量",
  description: "按 USDA SR Legacy 已核验目录，对名称和烹饪状态完全匹配、且有明确克数的单一食材计算热量。不能估复合菜、不能换算碗/个/勺，未匹配时返回待核实；调用前必须有用户给出的克数。",
  parameters: Params,
  async execute(_toolCallId: string, params: ParamsType) {
    const entry = findNutritionCatalogEntry(params.foodName, params.sourceRecordId);
    if (!entry) {
      return {
        content: [{ type: "text" as const, text: `未找到精确匹配的食材或烹饪状态：“${params.foodName}”。该项标记为待核实，不能给出精确热量。` }],
        details: { matched: false, status: "unavailable", clarificationRequired: true },
      };
    }
    const nutrition = estimateCatalogNutrition(params.foodName, params.grams, params.sourceRecordId);
    if (!nutrition) {
      return {
        content: [{ type: "text" as const, text: "克数必须是大于 0 的有效数字；没有克数时无法从目录换算热量。" }],
        details: { matched: true, status: "unavailable", clarificationRequired: true },
      };
    }
    return {
      content: [{ type: "text" as const, text: `${nutrition.foodName} ${params.grams} g：${nutrition.calories} kcal。形态：${nutrition.cookingMethod}。来源：${nutrition.source}，FDC ID ${nutrition.sourceRecordId}，版本 ${nutrition.sourceVersion}；数据基准为每 100 g。` }],
      details: { matched: true, nutrition, referenceCaloriesPer100g: entry.caloriesPer100g, fdcDescription: entry.fdcDescription },
    };
  },
});
