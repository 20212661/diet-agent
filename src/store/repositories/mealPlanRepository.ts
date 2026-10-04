import { revalidateMealPlan } from "../../recipes/mealPlanValidation.js";
import { getRecipeBook } from "./recipeRepository.js";
import { getKitchenProfile } from "./kitchenProfileRepository.js";
import { getIngredientInventory } from "./inventoryRepository.js";
import { getUserProfile } from "./userProfileRepository.js";
import type { MealPlan, MealPlanConstraints, MealPlanDay } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { nowISO, parseJsonArray, parseJsonField, stringifyJson, todayDate } from "../shared.js";

interface MealPlanRow {
  user_id: string;
  start_date: string;
  days_json: string;
  target: string | null;
  goal: MealPlan["goal"] | null;
  constraints_json: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: MealPlanRow): MealPlan {
  return {
    userId: row.user_id,
    startDate: row.start_date,
    days: parseJsonArray<MealPlanDay>(row.days_json),
    ...(row.target ? { target: row.target } : {}),
    ...(row.goal ? { goal: row.goal } : {}),
    constraints: {
      temporaryAvoidFoods: [],
      timeLimitMinutes: 20,
      energyLevel: "normal",
      preferredStyles: [],
      ...parseJsonField<Partial<MealPlanConstraints>>(row.constraints_json, {}),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertMealPlan(
  userId: string,
  startDate: string,
  days: MealPlanDay[],
  options: { target?: string; goal?: MealPlan["goal"]; constraints?: MealPlanConstraints } = {},
): MealPlan {
  const db = getDatabase();
  const now = nowISO();
  const row = db.prepare(
    "SELECT created_at FROM meal_plans WHERE user_id = ? AND start_date = ?",
  ).get(userId, startDate) as { created_at: string } | undefined;
  const plan: MealPlan = {
    userId,
    startDate,
    days,
    ...(options.target ? { target: options.target } : {}),
    ...(options.goal ? { goal: options.goal } : {}),
    ...(options.constraints ? { constraints: options.constraints } : {}),
    createdAt: row?.created_at ?? now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO meal_plans (user_id, start_date, days_json, target, goal, constraints_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, start_date) DO UPDATE SET
      days_json = excluded.days_json,
      target = excluded.target,
      goal = excluded.goal,
      constraints_json = excluded.constraints_json,
      updated_at = excluded.updated_at
  `).run(userId, startDate, stringifyJson(days), plan.target ?? null, plan.goal ?? null, stringifyJson(plan.constraints ?? {}), plan.createdAt, now);
  return plan;
}

/** Return the newest saved plan that contains the requested calendar date. */
export function getMealPlan(userId: string, date = todayDate()): MealPlan | undefined {
  const rows = getDatabase().prepare(`
    SELECT user_id, start_date, days_json, target, goal, constraints_json, created_at, updated_at
    FROM meal_plans WHERE user_id = ? AND start_date <= ?
    ORDER BY start_date DESC
  `).all(userId, date) as MealPlanRow[];
  for (const row of rows) {
    const plan = fromRow(row);
    if (plan.days.some((day) => day.date === date)) return validate(plan);
  }
  return undefined;
}

export function getMealPlanByStartDate(userId: string, startDate: string): MealPlan | undefined {
  const row = getDatabase().prepare(`
    SELECT user_id, start_date, days_json, target, goal, constraints_json, created_at, updated_at
    FROM meal_plans WHERE user_id = ? AND start_date = ?
  `).get(userId, startDate) as MealPlanRow | undefined;
  return row ? validate(fromRow(row)) : undefined;
}

function validate(plan: MealPlan): MealPlan {
  return revalidateMealPlan(plan, { recipes: getRecipeBook(), kitchen: getKitchenProfile(plan.userId),
    inventory: getIngredientInventory(plan.userId), profile: getUserProfile(plan.userId) });
}
