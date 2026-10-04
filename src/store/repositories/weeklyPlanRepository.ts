import { assessFoodSafety } from "../../recipes/foodSafety.js";
import { recipeBlockReason } from "../../recipes/executionConstraints.js";
import { isAvailableOn, type IngredientReadiness, type WeeklyDayPlan, type WeeklyPlan } from "../../types/diet.js";
import { computeIngredientReadiness } from "../../recipes/recipeMatcher.js";
import { getRecipeBook } from "./recipeRepository.js";
import { getIngredientInventory } from "./inventoryRepository.js";
import { getKitchenProfile } from "./kitchenProfileRepository.js";
import { getUserProfile } from "./userProfileRepository.js";
import { getDatabase } from "../database.js";
import { nowISO, parseJsonArray, stringifyJson } from "../shared.js";
import { getMealLogsByDate } from "./mealRepository.js";
import { isTraceableNutrition } from "../../nutrition/nutritionEstimate.js";
import { mealFitsTimeLimits } from "../../recipes/mealTiming.js";

function getMondayOfWeek(date?: string): string {
  const value = date ? new Date(`${date}T00:00:00`) : new Date();
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${dateOfMonth}`;
}

export function upsertWeeklyPlan(userId: string, weekStartDate: string, days: WeeklyDayPlan[]): WeeklyPlan {
  const db = getDatabase();
  const now = nowISO();
  const row = db.prepare(
    "SELECT created_at, updated_at FROM weekly_plans WHERE user_id = ? AND week_start_date = ?"
  ).get(userId, weekStartDate) as { created_at: string; updated_at: string } | undefined;
  const updatedAt = row ? nextUpdatedAt(row.updated_at) : now;
  const plan: WeeklyPlan = {
    userId, weekStartDate, days, status: "active", createdAt: row?.created_at ?? now, updatedAt,
  };
  db.transaction(() => {
    db.prepare(`
      INSERT INTO weekly_plans (user_id, week_start_date, days_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, week_start_date) DO UPDATE SET
        days_json = excluded.days_json, status = excluded.status, updated_at = excluded.updated_at
    `).run(userId, weekStartDate, stringifyJson(days), "active", plan.createdAt, updatedAt);
    db.prepare("DELETE FROM weekly_plan_day_status WHERE user_id = ? AND week_start_date = ?").run(userId, weekStartDate);
  })();
  return plan;
}

export function getWeeklyPlan(userId: string, weekStartDate?: string): WeeklyPlan | undefined {
  const row = getDatabase().prepare(`
    SELECT * FROM weekly_plans
    WHERE user_id = ? AND week_start_date = ? AND status = 'active'
  `).get(userId, weekStartDate ?? getMondayOfWeek()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const inventory = getIngredientInventory(userId);
  const recipeBook = getRecipeBook();
  const recipesById = new Map(recipeBook.map((recipe) => [recipe.id, recipe]));
  const kitchen = getKitchenProfile(userId);
  const profile = getUserProfile(userId);
  const safeRecipeIds = new Set(recipeBook.filter((recipe) => !recipeBlockReason(recipe, kitchen, profile)).map((recipe) => recipe.id));
  const days = parseJsonArray<WeeklyDayPlan>(row.days_json as string).map((day) => {
    const completion = getDatabase().prepare(`
      SELECT completed_at FROM weekly_plan_day_status
      WHERE user_id = ? AND week_start_date = ? AND date = ? AND recipe_id = ?
    `).get(userId, row.week_start_date, day.date, day.mainRecipe.id) as { completed_at: string } | undefined;
    const dinnerLogs = getMealLogsByDate(userId, day.date).some((log) => log.mealType === "dinner");
    const currentMain = recipesById.get(day.mainRecipe.id);
    const currentSide = day.sideRecipe ? recipesById.get(day.sideRecipe.id) : undefined;
    const mainSafe = safeRecipeIds.has(day.mainRecipe.id);
    const sideSafe = Boolean(day.sideRecipe && safeRecipeIds.has(day.sideRecipe.id)
      && currentMain && currentSide && mealFitsTimeLimits(currentMain, currentSide, kitchen));
    const readiness: IngredientReadiness[] = (() => {
      if (!mainSafe) return [];
      const main = recipesById.get(day.mainRecipe.id);
      const side = sideSafe && day.sideRecipe ? recipesById.get(day.sideRecipe.id) : undefined;
      return main
        ? computeIngredientReadiness(
          [...main.ingredients, ...(side?.ingredients ?? [])],
          inventory.availableIngredients.filter((item) => isAvailableOn(item, day.date)),
          inventory.shoppingList,
          day.date,
        )
        : day.ingredientReadiness ?? day.missingIngredients.map((ingredient) => ({ ingredient, status: "to_add_to_list" as const }));
    })();
    const mainRecipe = {
      ...day.mainRecipe,
      ...(currentMain ? { activeMinutes: currentMain.activeMinutes, totalMinutes: currentMain.totalMinutes } : {}),
      name: mainSafe ? day.mainRecipe.name : "需重新安排",
      nutrition: isTraceableNutrition(day.mainRecipe.nutrition) ? day.mainRecipe.nutrition : undefined,
      estimatedCalories: undefined,
    };
    return {
      ...day,
      mainRecipe,
      sideRecipe: mainSafe && sideSafe && currentSide ? { id: currentSide.id, name: currentSide.name,
        activeMinutes: currentSide.activeMinutes, totalMinutes: currentSide.totalMinutes } : undefined,
      staplesSuggestion: day.staplesSuggestion.split(/[或、，,]/).filter((staple) =>
        assessFoodSafety([staple], profile).status === "clear").join("或") || "主食建议待核实",
      executionBlockedReason: mainSafe ? undefined : "当前过敏、忌口、厨房设备或时间条件与计划生成时不同，请选择符合条件的候选或重新生成计划。",
      ingredientReadiness: readiness,
      missingIngredients: readiness.filter((item) => item.status !== "owned").map((item) => item.ingredient),
      completed: mainSafe && Boolean(completion),
      hasDinnerLog: dinnerLogs,
      completedAt: mainSafe ? completion?.completed_at : undefined,
    };
  });
  return {
    userId: row.user_id as string,
    weekStartDate: row.week_start_date as string,
    days,
    status: row.status as WeeklyPlan["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export type WeeklyPlanMutationResult =
  | { status: "updated"; plan: WeeklyPlan }
  | { status: "conflict"; plan?: WeeklyPlan }
  | { status: "not_found" };

function nextUpdatedAt(previous: string): string {
  const value = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isFinite(value) ? value + 1 : 0)).toISOString();
}

export function replaceWeeklyPlanDayMainRecipe(
  userId: string,
  weekStartDate: string,
  date: string,
  expectedUpdatedAt: string,
  dayPatch: Pick<WeeklyDayPlan, "mainRecipe" | "sideRecipe" | "staplesSuggestion" | "reasons" | "missingIngredients" | "ingredientReadiness">,
): WeeklyPlanMutationResult {
  const db = getDatabase();
  const result = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM weekly_plans WHERE user_id = ? AND week_start_date = ? AND status = 'active'`)
      .get(userId, weekStartDate) as Record<string, unknown> | undefined;
    if (!row) return { status: "not_found" } as const;
    if (row.updated_at !== expectedUpdatedAt) return { status: "conflict" } as const;
    const days = parseJsonArray<WeeklyDayPlan>(row.days_json as string);
    const index = days.findIndex((day) => day.date === date);
    if (index < 0) return { status: "not_found" } as const;
    days[index] = { ...days[index]!, ...dayPatch, completed: false, completedAt: undefined };
    // A completion belongs to a specific selected recipe. Clearing the date also prevents a later switch-back inheriting it.
    db.prepare("DELETE FROM weekly_plan_day_status WHERE user_id = ? AND week_start_date = ? AND date = ?")
      .run(userId, weekStartDate, date);
    const updatedAt = nextUpdatedAt(row.updated_at as string);
    db.prepare("UPDATE weekly_plans SET days_json = ?, updated_at = ? WHERE user_id = ? AND week_start_date = ?")
      .run(stringifyJson(days), updatedAt, userId, weekStartDate);
    return { status: "updated", updatedAt } as const;
  })();
  if (result.status === "conflict") return { status: "conflict", plan: getWeeklyPlan(userId, weekStartDate) };
  if (result.status === "not_found") return result;
  const plan = getWeeklyPlan(userId, weekStartDate);
  return plan ? { status: "updated", plan } : { status: "not_found" };
}

export function setWeeklyPlanDayCompleted(
  userId: string,
  weekStartDate: string,
  date: string,
  recipeId: string,
  expectedUpdatedAt: string,
  completed: boolean,
): WeeklyPlanMutationResult {
  const db = getDatabase();
  const result = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM weekly_plans WHERE user_id = ? AND week_start_date = ? AND status = 'active'`)
      .get(userId, weekStartDate) as Record<string, unknown> | undefined;
    if (!row) return { status: "not_found" } as const;
    if (row.updated_at !== expectedUpdatedAt) return { status: "conflict" } as const;
    const days = parseJsonArray<WeeklyDayPlan>(row.days_json as string);
    const targetDay = days.find((day) => day.date === date && day.mainRecipe.id === recipeId);
    if (!targetDay) return { status: "conflict" } as const;
    if (completed) {
      const kitchen = getKitchenProfile(userId);
      const profile = getUserProfile(userId);
      const recipe = getRecipeBook().find((r) => r.id === recipeId);
      if (!recipe || recipeBlockReason(recipe, kitchen, profile)) {
        return { status: "conflict" } as const;
      }
      db.prepare(`INSERT INTO weekly_plan_day_status (user_id, week_start_date, date, recipe_id, completed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, week_start_date, date, recipe_id)
        DO UPDATE SET completed_at = excluded.completed_at`).run(userId, weekStartDate, date, recipeId, nowISO());
    } else {
      db.prepare(`DELETE FROM weekly_plan_day_status WHERE user_id = ? AND week_start_date = ? AND date = ? AND recipe_id = ?`)
        .run(userId, weekStartDate, date, recipeId);
    }
    const updatedAt = nextUpdatedAt(row.updated_at as string);
    db.prepare("UPDATE weekly_plans SET updated_at = ? WHERE user_id = ? AND week_start_date = ?")
      .run(updatedAt, userId, weekStartDate);
    return { status: "updated", updatedAt } as const;
  })();
  if (result.status === "conflict") return { status: "conflict", plan: getWeeklyPlan(userId, weekStartDate) };
  if (result.status === "not_found") return result;
  const plan = getWeeklyPlan(userId, weekStartDate);
  return plan ? { status: "updated", plan } : { status: "not_found" };
}

export function clearWeeklyPlan(userId: string, weekStartDate?: string): boolean {
  const result = getDatabase().prepare(`
    UPDATE weekly_plans SET status = 'archived', updated_at = ?
    WHERE user_id = ? AND week_start_date = ? AND status = 'active'
  `).run(nowISO(), userId, weekStartDate ?? getMondayOfWeek());
  return result.changes > 0;
}
