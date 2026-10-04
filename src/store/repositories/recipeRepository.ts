import type { RecipeRecord } from "../../types/diet.js";
import { recipeBook } from "../../recipes/recipeBook.js";
import { getDatabase } from "../database.js";
import { nowISO, parseJsonArray, parseJsonField, stringifyJson } from "../shared.js";

const seededDatabases = new WeakSet<object>();

function writeRecipe(recipe: Omit<RecipeRecord, "updatedAt">, updatedAt: string): void {
  const db = getDatabase();
  const mode = recipe.mode ?? recipe.modes?.[0] ?? "quick";
  db.prepare(`
    INSERT INTO recipe_book (
      id, name, mode, meal_types_json, modes_json, suitable_goals_json,
      ingredients_json, optional_ingredients_json, ingredient_ids_json, allergen_tags_json,
      primary_protein, vegetables_json, staples_json,
      cookware_json, appliances_json, active_minutes, total_minutes, difficulty, dish_count,
      steps_json, taste_tags_json, preference_tags_json, season_tags_json, timeline_json,
      low_energy_swap, weekend_prep, freezer_reuse, estimated_calories, protein_level, updated_at
      , nutrition_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, mode = excluded.mode, meal_types_json = excluded.meal_types_json,
      modes_json = excluded.modes_json, suitable_goals_json = excluded.suitable_goals_json,
      ingredients_json = excluded.ingredients_json, optional_ingredients_json = excluded.optional_ingredients_json,
      ingredient_ids_json = excluded.ingredient_ids_json, allergen_tags_json = excluded.allergen_tags_json,
      primary_protein = excluded.primary_protein, vegetables_json = excluded.vegetables_json,
      staples_json = excluded.staples_json, cookware_json = excluded.cookware_json,
      appliances_json = excluded.appliances_json, active_minutes = excluded.active_minutes,
      total_minutes = excluded.total_minutes, difficulty = excluded.difficulty,
      dish_count = excluded.dish_count, steps_json = excluded.steps_json,
      taste_tags_json = excluded.taste_tags_json, preference_tags_json = excluded.preference_tags_json,
      season_tags_json = excluded.season_tags_json, timeline_json = excluded.timeline_json,
      low_energy_swap = excluded.low_energy_swap, weekend_prep = excluded.weekend_prep,
      freezer_reuse = excluded.freezer_reuse, estimated_calories = excluded.estimated_calories,
      protein_level = excluded.protein_level, updated_at = excluded.updated_at,
      nutrition_json = excluded.nutrition_json
  `).run(
    recipe.id, recipe.name, mode, stringifyJson(recipe.mealTypes ?? []),
    stringifyJson(recipe.modes ?? [mode]), stringifyJson(recipe.suitableGoals ?? []),
    stringifyJson(recipe.ingredients), stringifyJson(recipe.optionalIngredients ?? []),
    stringifyJson(recipe.ingredientIds), stringifyJson(recipe.allergenTags),
    recipe.primaryProtein ?? null, stringifyJson(recipe.vegetables ?? []), stringifyJson(recipe.staples ?? []),
    stringifyJson(recipe.cookware), stringifyJson(recipe.appliances ?? []), recipe.activeMinutes,
    recipe.totalMinutes, recipe.difficulty ?? 2, recipe.dishCount ?? 2, stringifyJson(recipe.steps),
    stringifyJson(recipe.tasteTags ?? []), stringifyJson(recipe.preferenceTags ?? []),
    stringifyJson(recipe.seasonTags ?? []), stringifyJson(recipe.timeline ?? []),
    recipe.lowEnergySwap ?? null, recipe.weekendPrep ?? null, recipe.freezerReuse ?? null,
    null, recipe.proteinLevel ?? null, updatedAt,
    recipe.nutrition ? JSON.stringify(recipe.nutrition) : null
  );
}

function ensureRecipeSeed(): void {
  const db = getDatabase();
  if (seededDatabases.has(db)) return;
  const now = nowISO();
  const seedAll = db.transaction(() => {
    for (const recipe of recipeBook) writeRecipe(recipe, now);
  });
  seedAll();
  seededDatabases.add(db);
}

export function getRecipeBook(): RecipeRecord[] {
  ensureRecipeSeed();
  const rows = getDatabase().prepare("SELECT * FROM recipe_book ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((row) => {
    const mode = row.mode as string;
    const modes = parseJsonArray<string>(row.modes_json as string);
    const seasons = parseJsonArray<string>(row.season_tags_json as string);
    const timeline = parseJsonArray<string>(row.timeline_json as string);
    return {
      id: row.id as string,
      name: row.name as string,
      mode,
      mealTypes: parseJsonArray<string>(row.meal_types_json as string) as RecipeRecord["mealTypes"],
      modes: (modes.length ? modes : [mode]) as RecipeRecord["modes"],
      suitableGoals: parseJsonArray<string>(row.suitable_goals_json as string),
      ingredients: parseJsonArray<string>(row.ingredients_json as string),
      optionalIngredients: parseJsonArray<string>(row.optional_ingredients_json as string),
      ingredientIds: parseJsonArray<string>(row.ingredient_ids_json as string),
      allergenTags: parseJsonArray<string>(row.allergen_tags_json as string) as RecipeRecord["allergenTags"],
      primaryProtein: (row.primary_protein as string) || undefined,
      vegetables: parseJsonArray<string>(row.vegetables_json as string),
      staples: parseJsonArray<string>(row.staples_json as string),
      cookware: parseJsonArray<string>(row.cookware_json as string),
      appliances: parseJsonArray<string>(row.appliances_json as string) as RecipeRecord["appliances"],
      activeMinutes: row.active_minutes as number,
      totalMinutes: row.total_minutes as number,
      difficulty: (row.difficulty as number) ?? 2,
      dishCount: (row.dish_count as number) ?? 2,
      steps: parseJsonField<string[]>(row.steps_json as string, []),
      tasteTags: parseJsonArray<string>(row.taste_tags_json as string),
      preferenceTags: parseJsonArray<string>(row.preference_tags_json as string),
      seasonTags: seasons.length ? seasons : undefined,
      timeline: timeline.length ? timeline : undefined,
      lowEnergySwap: (row.low_energy_swap as string) || undefined,
      weekendPrep: (row.weekend_prep as string) || undefined,
      freezerReuse: (row.freezer_reuse as string) || undefined,
      nutrition: row.nutrition_json ? JSON.parse(row.nutrition_json as string) as RecipeRecord["nutrition"] : undefined,
      // Older databases may contain naked values; do not expose them as nutrition facts.
      estimatedCalories: undefined,
      proteinLevel: (row.protein_level as RecipeRecord["proteinLevel"]) || undefined,
      updatedAt: row.updated_at as string,
    };
  });
}

export function getRecipeById(recipeId: string): RecipeRecord | undefined {
  return getRecipeBook().find((recipe) => recipe.id === recipeId);
}

export function upsertRecipe(recipe: Omit<RecipeRecord, "updatedAt">): RecipeRecord {
  ensureRecipeSeed();
  const updatedAt = nowISO();
  writeRecipe(recipe, updatedAt);
  return { ...recipe, updatedAt };
}
