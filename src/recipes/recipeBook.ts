import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecipeRecord } from "../types/diet.js";
import { normalizeIngredientId } from "./ingredientTaxonomy.js";
import { assessFoodSafety } from "./foodSafety.js";
import { validateRecipeSeed } from "./recipeSchema.js";

export type RecipeBookItem = Omit<RecipeRecord, "updatedAt">;

function loadRecipeSeed(): RecipeBookItem[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const filePath = join(dir, "recipeSeed.json");
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const errors = validateRecipeSeed(parsed);
  if (errors.length > 0) throw new Error(`Invalid recipeSeed.json:\n${errors.join("\n")}`);
  return parsed as RecipeBookItem[];
}

/** HowToCook 导入菜谱（人工审阅通过后准入；来源与生成信息在文件顶层 _meta）。 */
function loadImportedRecipes(): RecipeBookItem[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const filePath = join(dir, "imported", "howtocook.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { recipes?: unknown };
  const recipes = parsed.recipes ?? [];
  const errors = validateRecipeSeed(recipes);
  if (errors.length > 0) throw new Error(`Invalid imported/howtocook.json:\n${errors.join("\n")}`);
  return recipes as RecipeBookItem[];
}

export const recipeBook = [...loadRecipeSeed(), ...loadImportedRecipes()];

export function findRecipeCandidates(ingredients: string[], avoidFoods: string[] = []) {
  const normalized = ingredients.map((item) => item.toLowerCase());
  const availableIds = new Set(ingredients.map(normalizeIngredientId));

  return recipeBook
    .map((recipe) => {
      const matched = recipe.ingredients.filter((ingredient) =>
        availableIds.has(normalizeIngredientId(ingredient)) ||
        normalized.some((item) => item.includes(ingredient.toLowerCase()) || ingredient.toLowerCase().includes(item))
      );
      const safety = assessFoodSafety(
        [...recipe.ingredients, ...(recipe.optionalIngredients ?? []), ...(recipe.vegetables ?? []), ...(recipe.staples ?? []), ...(recipe.primaryProtein ? [recipe.primaryProtein] : [])],
        { avoidFoods },
        recipe.allergenTags,
      );
      const blocked = safety.status !== "clear";
      return { recipe, matchedCount: matched.length, blocked };
    })
    .filter((item) => !item.blocked)
    .sort((a, b) => b.matchedCount - a.matchedCount || a.recipe.totalMinutes - b.recipe.totalMinutes)
    .map((item) => item.recipe);
}
