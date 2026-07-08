import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecipeRecord } from "../types/diet.js";

export type RecipeBookItem = Omit<RecipeRecord, "updatedAt">;

function loadRecipeSeed(): RecipeBookItem[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const filePath = join(dir, "recipeSeed.json");
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as RecipeBookItem[];
}

export const recipeBook = loadRecipeSeed();

export function findRecipeCandidates(ingredients: string[], avoidFoods: string[] = []) {
  const normalized = ingredients.map((item) => item.toLowerCase());
  const avoid = avoidFoods.map((item) => item.toLowerCase());

  return recipeBook
    .map((recipe) => {
      const matched = recipe.ingredients.filter((ingredient) =>
        normalized.some((item) => item.includes(ingredient.toLowerCase()) || ingredient.toLowerCase().includes(item))
      );
      const blocked = [...recipe.ingredients, ...(recipe.optionalIngredients ?? [])].some((ingredient) =>
        avoid.some((item) => ingredient.toLowerCase().includes(item) || item.includes(ingredient.toLowerCase()))
      );
      return { recipe, matchedCount: matched.length, blocked };
    })
    .filter((item) => !item.blocked)
    .sort((a, b) => b.matchedCount - a.matchedCount || a.recipe.totalMinutes - b.recipe.totalMinutes)
    .map((item) => item.recipe);
}
