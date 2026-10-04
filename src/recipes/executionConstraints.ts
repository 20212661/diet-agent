import type { KitchenProfile, RecipeAppliance, RecipeRecord } from "../types/diet.js";
import { assessFoodSafety, type FoodSafetyProfile } from "./foodSafety.js";

export interface ExecutableMeal {
  ingredients: readonly string[];
  appliances: readonly RecipeAppliance[];
  cookware: readonly string[];
  activeMinutes: number;
  totalMinutes: number;
}

const normalize = (value: string) => value.toLowerCase().trim();

/** Shared hard constraints for recipe plans and fully specified fallback templates. */
export function executionBlockReason(
  meal: ExecutableMeal,
  kitchen: KitchenProfile,
  profile: FoodSafetyProfile = {},
  maxActiveMinutes = kitchen.maxActiveMinutes,
): string | undefined {
  const safety = assessFoodSafety(meal.ingredients, profile);
  if (safety.status !== "clear") return "食材与当前过敏或忌口冲突，或需要核实。";
  if (!Number.isFinite(meal.activeMinutes) || !Number.isFinite(meal.totalMinutes)
    || meal.activeMinutes < 0 || meal.totalMinutes < meal.activeMinutes) return "缺少可靠的烹饪时间信息。";
  if (meal.activeMinutes > Math.min(maxActiveMinutes, kitchen.maxActiveMinutes)
    || meal.totalMinutes > kitchen.maxTotalMinutes) return "超过当前主动操作或总耗时上限。";
  const available: Record<RecipeAppliance, boolean> = {
    stove: kitchen.burners > 0, oven: kitchen.hasOven,
    microwave: kitchen.hasMicrowave, rice_cooker: kitchen.hasRiceCooker,
  };
  if (meal.appliances.some((item) => !available[item])) return "缺少必需厨房设备。";
  if (meal.cookware.some((required) => !kitchen.cookware.some((owned) =>
    normalize(owned).includes(normalize(required)) || normalize(required).includes(normalize(owned))))) {
    return "缺少必需厨具。";
  }
  return undefined;
}

export function recipeBlockReason(
  recipe: RecipeRecord, kitchen: KitchenProfile, profile: FoodSafetyProfile = {}, maxActiveMinutes?: number,
): string | undefined {
  const ingredients = [...recipe.ingredients, ...(recipe.optionalIngredients ?? []),
    ...(recipe.vegetables ?? []), ...(recipe.staples ?? []), ...(recipe.primaryProtein ? [recipe.primaryProtein] : [])];
  if (assessFoodSafety(ingredients, profile, recipe.allergenTags).status !== "clear") {
    return "菜谱与当前过敏或忌口冲突，或需要核实。";
  }
  return executionBlockReason({ ...recipe, ingredients }, kitchen, profile, maxActiveMinutes);
}
