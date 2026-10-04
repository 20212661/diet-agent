import type { CookingFeedback } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { generateId, nowISO } from "../shared.js";

export type AddCookingFeedbackInput = Omit<CookingFeedback, "id" | "createdAt">;

export function addCookingFeedback(input: AddCookingFeedbackInput): CookingFeedback {
  const db = getDatabase();
  const entry: CookingFeedback = { ...input, id: generateId("fb"), createdAt: nowISO() };
  db.prepare(`
    INSERT INTO cooking_feedback (id, user_id, recipe_id, recipe_name, rating,
      actual_active_minutes, actual_total_minutes, too_tiring, too_many_dishes,
      would_cook_again, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id, entry.userId, entry.recipeId ?? null, entry.recipeName ?? null, entry.rating ?? null,
    entry.actualActiveMinutes ?? null, entry.actualTotalMinutes ?? null,
    entry.tooTiring ? 1 : 0, entry.tooManyDishes ? 1 : 0,
    entry.wouldCookAgain == null ? null : entry.wouldCookAgain ? 1 : 0,
    entry.note ?? null, entry.createdAt
  );
  return entry;
}

export function getCookingFeedback(userId: string): CookingFeedback[] {
  const rows = getDatabase().prepare(
    "SELECT * FROM cooking_feedback WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    recipeId: (row.recipe_id as string) || undefined,
    recipeName: (row.recipe_name as string) || undefined,
    rating: (row.rating as number) ?? undefined,
    actualActiveMinutes: (row.actual_active_minutes as number) ?? undefined,
    actualTotalMinutes: (row.actual_total_minutes as number) ?? undefined,
    tooTiring: !!row.too_tiring,
    tooManyDishes: !!row.too_many_dishes,
    wouldCookAgain: row.would_cook_again == null ? undefined : !!row.would_cook_again,
    note: (row.note as string) || undefined,
    createdAt: row.created_at as string,
  }));
}
