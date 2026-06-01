import * as store from "../store/index.js";
import type { RecipeMode, RecipeRecord } from "../types/diet.js";

function norm(value: string): string {
  return value.toLowerCase().trim();
}

function inferModes(tags: string[]): RecipeMode[] {
  const modes: RecipeMode[] = [];
  const text = tags.join(" ");
  if (/快手|快速|省时/.test(text)) modes.push("quick");
  if (/一锅|一锅出|少洗碗/.test(text)) modes.push("one_pot");
  if (/低能量|省力|懒人/.test(text)) modes.push("low_energy");
  return modes.length > 0 ? modes : ["quick"];
}

function toRecipeRecord(recipe: store.UserRecipe): RecipeRecord {
  const modes = inferModes(recipe.tags);
  return {
    id: recipe.id,
    name: recipe.name,
    mode: modes[0],
    mealTypes: ["dinner"],
    modes,
    suitableGoals: [],
    ingredients: recipe.ingredients,
    optionalIngredients: [],
    vegetables: [],
    staples: [],
    cookware: [],
    appliances: [],
    activeMinutes: recipe.activeMinutes ?? 15,
    totalMinutes: recipe.totalMinutes ?? recipe.activeMinutes ?? 25,
    difficulty: 2,
    dishCount: modes.includes("one_pot") ? 1 : 2,
    tasteTags: recipe.tags,
    preferenceTags: recipe.tags,
    steps: recipe.steps,
    estimatedCalories: recipe.estimatedCalories,
    updatedAt: recipe.updatedAt,
  };
}

function latestCorrectionsByRecipe(userId: string): Map<string, number> {
  const corrections = new Map<string, number>();
  for (const correction of store.getCalorieCorrections(userId)) {
    const key = norm(correction.recipeName);
    if (!corrections.has(key)) corrections.set(key, correction.correctedCalories);
  }
  return corrections;
}

export function getEffectiveCalories(
  userId: string,
  recipeName: string,
  fallback?: number,
): number | undefined {
  return latestCorrectionsByRecipe(userId).get(norm(recipeName)) ?? fallback;
}

export function listForUser(userId: string): RecipeRecord[] {
  const corrections = latestCorrectionsByRecipe(userId);
  const recipes = [
    ...store.getRecipeBook(),
    ...store.getUserRecipes(userId).map(toRecipeRecord),
  ];

  return recipes.map((recipe) => ({
    ...recipe,
    estimatedCalories: corrections.get(norm(recipe.name)) ?? recipe.estimatedCalories,
  }));
}
