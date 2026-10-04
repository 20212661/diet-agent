import * as store from "../store/index.js";
import { matchRecipes, computeIngredientReadiness, type MatchRecipeResult } from "../recipes/recipeMatcher.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";
import { recipeBlockReason } from "../recipes/executionConstraints.js";
import { mealFitsTimeLimits } from "../recipes/mealTiming.js";
import type { IngredientItem, WeeklyDayPlan } from "../types/diet.js";
import { getRecipeById } from "../store/repositories/recipeRepository.js";

export function findRecipe(recipeId: string) {
  return getRecipeById(recipeId);
}

export function getWeeklyPlanAlternatives(userId: string, weekStartDate: string, date: string) {
  const plan = store.getWeeklyPlan(userId, weekStartDate);
  const day = plan?.days.find((item) => item.date === date);
  if (!plan || !day) return { status: "not_found" as const };
  const kitchen = store.getKitchenProfile(userId);
  const inventory = store.getIngredientInventory(userId);
  const matches = getSafeMatches(userId, day, plan.days, inventory.availableIngredients, inventory.shoppingList);
  return {
    status: "ok" as const,
    updatedAt: plan.updatedAt,
    currentRecipeId: day.mainRecipe.id,
    alternatives: matches.filter((match) => match.recipe.id !== day.mainRecipe.id).slice(0, 8).map((match) => ({
      recipe: match.recipe,
      reasons: match.reasons,
      ingredientReadiness: computeIngredientReadiness(match.recipe.ingredients, inventory.availableIngredients, inventory.shoppingList, date),
    })),
    kitchen,
  };
}

export function replacePlanDayRecipe(
  userId: string,
  weekStartDate: string,
  date: string,
  expectedUpdatedAt: string,
  recipeId: string,
) {
  const plan = store.getWeeklyPlan(userId, weekStartDate);
  if (!plan) return { status: "not_found" as const };
  if (plan.updatedAt !== expectedUpdatedAt) return { status: "conflict" as const, plan };
  const day = plan.days.find((item) => item.date === date);
  if (!day) return { status: "not_found" as const };
  const inventory = store.getIngredientInventory(userId);
  const matches = getSafeMatches(userId, day, plan.days, inventory.availableIngredients, inventory.shoppingList);
  const candidate = matches.find((match) => match.recipe.id === recipeId);
  if (!candidate || recipeId === day.mainRecipe.id) return { status: "invalid_recipe" as const };
  const sideRecipe = day.sideRecipe
    ? matches.find((match) => match.recipe.id === day.sideRecipe!.id)?.recipe
    : undefined;
  const side = sideRecipe && sideRecipe.id !== candidate.recipe.id
    && mealFitsTimeLimits(candidate.recipe, sideRecipe, store.getKitchenProfile(userId)) ? sideRecipe : undefined;
  const ingredientReadiness = computeIngredientReadiness(
    [...candidate.recipe.ingredients, ...(side?.ingredients ?? [])],
    inventory.availableIngredients,
    inventory.shoppingList,
    date,
  );
  const safeStaples = (candidate.recipe.staples ?? []).filter((staple) =>
    assessFoodSafety([staple], store.getUserProfile(userId)).status === "clear"
  );
  const safeDefaultStaples = ["米饭", "面条", "馒头"].filter((staple) =>
    assessFoodSafety([staple], store.getUserProfile(userId)).status === "clear"
  );
  const patch: Pick<WeeklyDayPlan, "mainRecipe" | "sideRecipe" | "staplesSuggestion" | "reasons" | "missingIngredients" | "ingredientReadiness"> = {
    mainRecipe: {
      id: candidate.recipe.id,
      name: candidate.recipe.name,
      activeMinutes: candidate.recipe.activeMinutes,
      totalMinutes: candidate.recipe.totalMinutes,
      nutrition: candidate.recipe.nutrition,
    },
    sideRecipe: side ? { id: side.id, name: side.name, activeMinutes: side.activeMinutes, totalMinutes: side.totalMinutes } : undefined,
    staplesSuggestion: safeStaples.length ? safeStaples.join("或") : safeDefaultStaples.join("或") || "主食建议待核实",
    reasons: candidate.reasons.slice(0, 3),
    ingredientReadiness,
    missingIngredients: ingredientReadiness.filter((item) => item.status !== "owned").map((item) => item.ingredient),
  };
  return store.replaceWeeklyPlanDayMainRecipe(userId, weekStartDate, date, expectedUpdatedAt, patch);
}

function getSafeMatches(
  userId: string,
  day: WeeklyDayPlan,
  days: WeeklyDayPlan[],
  ownedItems: IngredientItem[],
  shoppingItems: IngredientItem[],
): MatchRecipeResult[] {
  const kitchen = store.getKitchenProfile(userId);
  const usedIds = new Set(days.filter((item) => item.date !== day.date).map((item) => item.mainRecipe.id));
  return matchRecipes({
    recipes: store.getRecipeBook(),
    date: day.date,
    availableIngredients: ownedItems,
    shoppingList: shoppingItems,
    kitchenProfile: kitchen,
    userProfile: store.getUserProfile(userId),
    feedback: store.getCookingFeedback(userId),
    timeLimitMinutes: kitchen.maxActiveMinutes,
  }).filter((match) => !usedIds.has(match.recipe.id)
    && !recipeBlockReason(match.recipe, kitchen, store.getUserProfile(userId)));
}
