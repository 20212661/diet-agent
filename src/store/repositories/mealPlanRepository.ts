import { revalidateMealPlan } from "../../recipes/mealPlanValidation.js";
import { listHouseholdMembers } from "./householdMemberRepository.js";
import { mergeDiningProfile, resolveDiningRefs, selfMemberFromProfile, toDiningMember } from "../../services/diningMembers.js";
import { getRecipeBookForUser } from "./userRecipeRepository.js";
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
  dining_members_json: string | null;
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
    ...(row.dining_members_json ? { diningMembers: parseJsonArray<string>(row.dining_members_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertMealPlan(
  userId: string,
  startDate: string,
  days: MealPlanDay[],
  options: { target?: string; goal?: MealPlan["goal"]; constraints?: MealPlanConstraints; diningMembers?: string[] } = {},
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
    ...(options.diningMembers && options.diningMembers.length > 0 ? { diningMembers: options.diningMembers } : {}),
    createdAt: row?.created_at ?? now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO meal_plans (user_id, start_date, days_json, target, goal, constraints_json, dining_members_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, start_date) DO UPDATE SET
      days_json = excluded.days_json,
      target = excluded.target,
      goal = excluded.goal,
      constraints_json = excluded.constraints_json,
      dining_members_json = excluded.dining_members_json,
      updated_at = excluded.updated_at
  `).run(userId, startDate, stringifyJson(days), plan.target ?? null, plan.goal ?? null, stringifyJson(plan.constraints ?? {}),
    plan.diningMembers ? stringifyJson(plan.diningMembers) : null, plan.createdAt, now);
  return plan;
}

/** Return the newest saved plan that contains the requested calendar date. */
export function getMealPlan(userId: string, date = todayDate()): MealPlan | undefined {
  const rows = getDatabase().prepare(`
    SELECT user_id, start_date, days_json, target, goal, constraints_json, dining_members_json, created_at, updated_at
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
    SELECT user_id, start_date, days_json, target, goal, constraints_json, dining_members_json, created_at, updated_at
    FROM meal_plans WHERE user_id = ? AND start_date = ?
  `).get(userId, startDate) as MealPlanRow | undefined;
  return row ? validate(fromRow(row)) : undefined;
}

function validate(plan: MealPlan): MealPlan {
  // 读取时重校验：按计划保存时的用餐成员重放过敏/忌口并集（已删除成员的引用被忽略）
  const base = getUserProfile(plan.userId);
  const dining = resolveDiningRefs(
    [selfMemberFromProfile(base), ...listHouseholdMembers(plan.userId).map(toDiningMember)],
    plan.diningMembers,
  ).members;
  return revalidateMealPlan(plan, { recipes: getRecipeBookForUser(plan.userId), kitchen: getKitchenProfile(plan.userId),
    inventory: getIngredientInventory(plan.userId), profile: mergeDiningProfile(base, dining) });
}
