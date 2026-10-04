import { createHash } from "node:crypto";
import type { AddMealLogInput, MealLog, MealType, TodaySummary, UpdateMealLogInput } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { generateId, nowISO, parseJsonArray, stringifyJson, todayDate } from "../shared.js";
import { formatNutritionCalories, getVerifiedCalories } from "../../nutrition/nutritionEstimate.js";

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function addMealLog(input: AddMealLogInput): MealLog {
  const db = getDatabase();
  const operationId = input.operationId ?? generateId("meal_op");
  const hash = requestHash({ date: input.date ?? null, mealType: input.mealType, foods: input.foods, note: input.note ?? null });
  const now = nowISO();
  const entry: MealLog = {
    id: generateId("meal"), userId: input.userId, operationId, date: input.date ?? todayDate(),
    mealType: input.mealType, foods: input.foods, note: input.note, createdAt: now,
  };
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT action, meal_log_id, result_json, request_hash FROM meal_operations WHERE user_id = ? AND operation_id = ?
    `).get(input.userId, operationId) as { action: string; meal_log_id: string; result_json: string; request_hash: string | null } | undefined;
    if (previous) {
      if (previous.action !== "create" || (previous.request_hash && previous.request_hash !== hash)) throw new Error("operationId is already used for a different meal operation");
      return JSON.parse(previous.result_json) as MealLog;
    }
    db.prepare(`
      INSERT INTO meal_logs (id, user_id, operation_id, date, meal_type, foods_json, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.userId, operationId, entry.date, entry.mealType, stringifyJson(entry.foods), entry.note ?? null, now);
    db.prepare(`
      INSERT INTO meal_operations (user_id, operation_id, action, meal_log_id, result_json, created_at, request_hash)
      VALUES (?, ?, 'create', ?, ?, ?, ?)
    `).run(input.userId, operationId, entry.id, JSON.stringify(entry), now, hash);
    return entry;
  })();
}

export function updateMealLog(input: UpdateMealLogInput): MealLog | undefined {
  const db = getDatabase();
  const now = nowISO();
  const hash = requestHash({ mealLogId: input.mealLogId, date: input.date ?? null, mealType: input.mealType ?? null, foods: input.foods ?? null, note: input.note ?? null });
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT action, meal_log_id, result_json, request_hash FROM meal_operations WHERE user_id = ? AND operation_id = ?
    `).get(input.userId, input.operationId) as { action: string; meal_log_id: string; result_json: string; request_hash: string | null } | undefined;
    if (previous) {
      if (previous.action !== "update" || previous.meal_log_id !== input.mealLogId || (previous.request_hash && previous.request_hash !== hash)) {
        throw new Error("operationId is already used for a different meal operation");
      }
      return JSON.parse(previous.result_json) as MealLog;
    }
    const row = db.prepare("SELECT * FROM meal_logs WHERE user_id = ? AND id = ? AND deleted_at IS NULL")
      .get(input.userId, input.mealLogId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const existing = mapMeal(row);
    const updated: MealLog = {
      ...existing,
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.mealType !== undefined ? { mealType: input.mealType } : {}),
      ...(input.foods !== undefined ? { foods: input.foods } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    db.prepare(`
      UPDATE meal_logs SET date = ?, meal_type = ?, foods_json = ?, note = ? WHERE user_id = ? AND id = ?
    `).run(updated.date, updated.mealType, stringifyJson(updated.foods), updated.note ?? null, input.userId, input.mealLogId);
    db.prepare(`
      INSERT INTO meal_operations (user_id, operation_id, action, meal_log_id, result_json, created_at, request_hash)
      VALUES (?, ?, 'update', ?, ?, ?, ?)
    `).run(input.userId, input.operationId, input.mealLogId, JSON.stringify(updated), now, hash);
    return updated;
  })();
}

export function undoMealLog(userId: string, mealLogId: string, operationId: string): { undone: boolean; mealLogId: string } {
  const db = getDatabase();
  const now = nowISO();
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT action, meal_log_id, result_json FROM meal_operations WHERE user_id = ? AND operation_id = ?
    `).get(userId, operationId) as { action: string; meal_log_id: string; result_json: string } | undefined;
    if (previous) {
      if (previous.action !== "undo" || previous.meal_log_id !== mealLogId) {
        throw new Error("operationId is already used for a different meal operation");
      }
      return JSON.parse(previous.result_json) as { undone: boolean; mealLogId: string };
    }
    const result = db.prepare("UPDATE meal_logs SET deleted_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL")
      .run(now, userId, mealLogId);
    const outcome = { undone: result.changes > 0, mealLogId };
    db.prepare(`
      INSERT INTO meal_operations (user_id, operation_id, action, meal_log_id, result_json, created_at)
      VALUES (?, ?, 'undo', ?, ?, ?)
    `).run(userId, operationId, mealLogId, JSON.stringify(outcome), now);
    return outcome;
  })();
}

export function restoreMealLog(userId: string, mealLogId: string, operationId: string): { restored: boolean; mealLogId: string } {
  const db = getDatabase();
  const now = nowISO();
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT action, meal_log_id, result_json FROM meal_operations WHERE user_id = ? AND operation_id = ?
    `).get(userId, operationId) as { action: string; meal_log_id: string; result_json: string } | undefined;
    if (previous) {
      if (previous.action !== "restore" || previous.meal_log_id !== mealLogId) {
        throw new Error("operationId is already used for a different meal operation");
      }
      return JSON.parse(previous.result_json) as { restored: boolean; mealLogId: string };
    }
    const result = db.prepare("UPDATE meal_logs SET deleted_at = NULL WHERE user_id = ? AND id = ? AND deleted_at IS NOT NULL")
      .run(userId, mealLogId);
    const outcome = { restored: result.changes > 0, mealLogId };
    db.prepare(`
      INSERT INTO meal_operations (user_id, operation_id, action, meal_log_id, result_json, created_at)
      VALUES (?, ?, 'restore', ?, ?, ?)
    `).run(userId, operationId, mealLogId, JSON.stringify(outcome), now);
    return outcome;
  })();
}

function mapMeal(row: Record<string, unknown>): MealLog {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    operationId: (row.operation_id as string) || undefined,
    date: row.date as string,
    mealType: row.meal_type as MealType,
    foods: parseJsonArray<MealLog["foods"][0]>(row.foods_json as string).map((food) => {
      const cleaned = { ...food };
      delete cleaned.estimatedCalories;
      return cleaned;
    }),
    note: (row.note as string) || undefined,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string) || undefined,
  };
}

export function getMealLogsByDate(userId: string, date?: string): MealLog[] {
  return (getDatabase().prepare(
    "SELECT * FROM meal_logs WHERE user_id = ? AND date = ? AND deleted_at IS NULL ORDER BY created_at"
  ).all(userId, date ?? todayDate()) as Record<string, unknown>[]).map(mapMeal);
}

export function getDeletedMealLogsByDate(userId: string, date: string): MealLog[] {
  return (getDatabase().prepare(
    "SELECT * FROM meal_logs WHERE user_id = ? AND date = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
  ).all(userId, date) as Record<string, unknown>[]).map(mapMeal);
}

export function getMealLogDates(userId: string, limit = 30): string[] {
  const safeLimit = Math.max(1, Math.min(90, Math.floor(limit)));
  return (getDatabase().prepare(`
    SELECT DISTINCT date FROM meal_logs WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY date DESC LIMIT ?
  `).all(userId, safeLimit) as Array<{ date: string }>).map((row) => row.date);
}

export function getAllMealLogs(userId: string): MealLog[] {
  return (getDatabase().prepare(
    "SELECT * FROM meal_logs WHERE user_id = ? AND deleted_at IS NULL ORDER BY date DESC, created_at"
  ).all(userId) as Record<string, unknown>[]).map(mapMeal);
}

export function getTodaySummary(userId: string, date?: string): TodaySummary {
  const targetDate = date ?? todayDate();
  const meals = getMealLogsByDate(userId, targetDate);
  const allFoods = meals.flatMap((meal) => meal.foods);
  const canTotal = allFoods.length > 0 && allFoods.every((food) => getVerifiedCalories(food.nutrition) !== undefined);
  const estimatedTotalCalories = canTotal
    ? allFoods.reduce((sum, food) => sum + getVerifiedCalories(food.nutrition)!, 0)
    : undefined;
  const labels: Record<string, string> = {
    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐", unknown: "其他",
  };
  const lines = meals.length === 0 ? [`${targetDate} 暂无饮食记录。`] : [
    `${targetDate} 共记录 ${meals.length} 餐：`,
    ...meals.map((meal) => {
      const foodText = meal.foods.map((food) => {
        const calories = formatNutritionCalories(food.nutrition);
        if (!calories) return `${food.name}${food.amount ? ` ${food.amount}` : ""}（热量未估算）`;
        const n = food.nutrition!;
        const portion = `${n.foodName} ${n.amount}${n.unit}${n.grams ? ` / ${n.grams}g` : ""}，${n.cookingMethod}`;
        return `${food.name}${food.amount ? ` ${food.amount}` : ""}（${calories}；${portion}；来源 ${n.source} ${n.sourceRecordId}，版本 ${n.sourceVersion}）`;
      }).join("、");
      return `- ${labels[meal.mealType] ?? meal.mealType}: ${foodText}（记录 ID: ${meal.id}）`;
    }),
    ...(estimatedTotalCalories !== undefined
      ? [`\n当日可追溯热量合计: ${Math.round(estimatedTotalCalories)} kcal`]
      : [`\n当日热量合计未显示：至少一项缺少可追溯的可靠数值。`]),
  ];
  return { userId, date: targetDate, meals, estimatedTotalCalories, summaryText: lines.join("\n") };
}
