/**
 * 用户自助导入菜谱（P5）。
 *
 * 与 recipe_book（种子 + HowToCook 导入，全局共享）分开存放：
 * user_recipes 以 (user_id, id) 为主键，检索/匹配按 userId 过滤，
 * /data、/diet-export、/delete-data 一并纳入。列布局与 recipe_book 一致。
 */
import type { RecipeRecord } from "../../types/diet.js";
import { getRecipeBook } from "./recipeRepository.js";
import { getDatabase } from "../database.js";
import { nowISO, parseJsonArray, parseJsonField, stringifyJson } from "../shared.js";

function writeUserRecipe(userId: string, recipe: Omit<RecipeRecord, "updatedAt">, updatedAt: string): void {
  const db = getDatabase();
  const mode = recipe.mode ?? recipe.modes?.[0] ?? "quick";
  db.prepare(`
    INSERT INTO user_recipes (
      user_id, id, name, mode, meal_types_json, modes_json, suitable_goals_json,
      ingredients_json, optional_ingredients_json, ingredient_ids_json, allergen_tags_json,
      primary_protein, vegetables_json, staples_json,
      cookware_json, appliances_json, active_minutes, total_minutes, difficulty, dish_count,
      steps_json, taste_tags_json, preference_tags_json, season_tags_json, timeline_json,
      low_energy_swap, weekend_prep, freezer_reuse, protein_level, nutrition_json,
      dismissed_allergen_warnings_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET
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
      freezer_reuse = excluded.freezer_reuse, protein_level = excluded.protein_level,
      nutrition_json = excluded.nutrition_json,
      dismissed_allergen_warnings_json = excluded.dismissed_allergen_warnings_json,
      updated_at = excluded.updated_at
  `).run(
    userId, recipe.id, recipe.name, mode, stringifyJson(recipe.mealTypes ?? []),
    stringifyJson(recipe.modes ?? [mode]), stringifyJson(recipe.suitableGoals ?? []),
    stringifyJson(recipe.ingredients), stringifyJson(recipe.optionalIngredients ?? []),
    stringifyJson(recipe.ingredientIds), stringifyJson(recipe.allergenTags),
    recipe.primaryProtein ?? null, stringifyJson(recipe.vegetables ?? []), stringifyJson(recipe.staples ?? []),
    stringifyJson(recipe.cookware), stringifyJson(recipe.appliances ?? []), recipe.activeMinutes,
    recipe.totalMinutes, recipe.difficulty ?? 2, recipe.dishCount ?? 2, stringifyJson(recipe.steps),
    stringifyJson(recipe.tasteTags ?? []), stringifyJson(recipe.preferenceTags ?? []),
    stringifyJson(recipe.seasonTags ?? []), stringifyJson(recipe.timeline ?? []),
    recipe.lowEnergySwap ?? null, recipe.weekendPrep ?? null, recipe.freezerReuse ?? null,
    recipe.proteinLevel ?? null, recipe.nutrition ? JSON.stringify(recipe.nutrition) : null,
    recipe.dismissedAllergenWarnings ? JSON.stringify(recipe.dismissedAllergenWarnings) : null,
    updatedAt, updatedAt
  );
}

function rowToRecord(row: Record<string, unknown>): RecipeRecord {
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
    estimatedCalories: undefined,
    proteinLevel: (row.protein_level as RecipeRecord["proteinLevel"]) || undefined,
    dismissedAllergenWarnings: row.dismissed_allergen_warnings_json
      ? JSON.parse(row.dismissed_allergen_warnings_json as string) as RecipeRecord["dismissedAllergenWarnings"]
      : undefined,
    updatedAt: row.updated_at as string,
  };
}

/** 某个用户自己导入的菜谱（不含全局库）。 */
export function getUserRecipes(userId: string): RecipeRecord[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM user_recipes WHERE user_id = ? ORDER BY name")
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

/** 全库所有用户菜谱（RAG 共享索引用；查询时仍按 userId 过滤）。 */
export function getAllUserRecipes(): RecipeRecord[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM user_recipes ORDER BY user_id, name")
    .all() as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

/** 用户可见菜谱集 = 全局库 + 该用户自己的导入（跨用户隔离的读取入口）。 */
export function getRecipeBookForUser(userId: string): RecipeRecord[] {
  return [...getRecipeBook(), ...getUserRecipes(userId)];
}

export function getUserRecipeById(userId: string, recipeId: string): RecipeRecord | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM user_recipes WHERE user_id = ? AND id = ?")
    .get(userId, recipeId) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : undefined;
}

/** 幂等 upsert：同 (user_id, id) 重导入/改名保存覆盖更新，created_at 保留首次值。 */
export function upsertUserRecipe(userId: string, recipe: Omit<RecipeRecord, "updatedAt">): RecipeRecord {
  const updatedAt = nowISO();
  writeUserRecipe(userId, recipe, updatedAt);
  const saved = getUserRecipeById(userId, recipe.id);
  // 覆盖更新时 writeRecipe 的 ON CONFLICT 不改 created_at；新插入时两者相同
  return saved ?? { ...recipe, updatedAt };
}

export function deleteUserRecipe(userId: string, recipeId: string): boolean {
  const result = getDatabase()
    .prepare("DELETE FROM user_recipes WHERE user_id = ? AND id = ?")
    .run(userId, recipeId);
  return result.changes > 0;
}
