import type { IngredientInventory, KitchenProfile, MealPlan, RecipeRecord, UserProfile } from "../types/diet.js";
import { assessFoodSafety } from "./foodSafety.js";
import { computeIngredientReadiness } from "./recipeMatcher.js";
import { executionBlockReason, recipeBlockReason } from "./executionConstraints.js";

export function revalidateMealPlan(plan: MealPlan, context: {
  recipes: RecipeRecord[]; kitchen: KitchenProfile; inventory: IngredientInventory; profile?: UserProfile;
}): MealPlan {
  const profile = {
    ...context.profile,
    avoidFoods: [...(context.profile?.avoidFoods ?? []), ...(plan.constraints?.temporaryAvoidFoods ?? [])],
  };
  const recipes = new Map(context.recipes.map((recipe) => [recipe.id, recipe]));
  return { ...plan, days: plan.days.map((day) => ({ ...day, meals: day.meals.map((meal) => {
    if (meal.source === "unavailable") return meal;
    const recipe = meal.recipeId ? recipes.get(meal.recipeId) : undefined;
    let reason: string | undefined;
    if (assessFoodSafety(meal.ingredients, profile).status !== "clear") {
      reason = "已保存食材与当前过敏或忌口冲突，或需要核实。";
    } else if (meal.source === "recipe") {
      reason = recipe ? recipeBlockReason(recipe, context.kitchen, profile, plan.constraints?.timeLimitMinutes)
        : "原菜谱已不存在，请重新安排。";
    } else if (!meal.appliances || !meal.cookware || meal.activeMinutes === undefined || meal.totalMinutes === undefined) {
      reason = "旧模板缺少设备或总耗时信息，请重新生成计划。";
    } else {
      reason = executionBlockReason({ ...meal, appliances: meal.appliances, cookware: meal.cookware,
        activeMinutes: meal.activeMinutes, totalMinutes: meal.totalMinutes }, context.kitchen, profile, plan.constraints?.timeLimitMinutes);
    }
    if (reason) return { ...meal, source: "unavailable" as const, name: "需重新安排（条件已变化）",
      ingredients: [], missingIngredients: [], nutrition: undefined, reasons: [reason], executionBlockedReason: reason };
    const ingredients = recipe ? [...new Set([...recipe.ingredients, ...(recipe.staples ?? [])])] : meal.ingredients;
    const missingIngredients = computeIngredientReadiness(ingredients, context.inventory.availableIngredients,
      context.inventory.shoppingList, day.date).filter((item) => item.status !== "owned").map((item) => item.ingredient);
    return { ...meal, ...(recipe ? { name: recipe.name, activeMinutes: recipe.activeMinutes,
      totalMinutes: recipe.totalMinutes, appliances: recipe.appliances, cookware: recipe.cookware } : {}),
      ingredients, missingIngredients,
      ...(JSON.stringify(missingIngredients) !== JSON.stringify(meal.missingIngredients) ? {
        reasons: [`库存已按 ${day.date} 重新核对。`, ...(missingIngredients.length ? [`需准备：${missingIngredients.join("、")}`] : [])],
      } : {}),
    };
  }) })) };
}
