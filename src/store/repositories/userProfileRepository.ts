import type { ActivityLevel, UpdateUserProfileInput, UserGoal, UserProfile } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { nowISO, nextUpdatedAt, parseJsonArray, stringifyJson } from "../shared.js";

type ScalarField = "goal" | "customGoal" | "heightCm" | "weightKg" | "age" | "gender" | "activityLevel";
export type UserProfilePatch = Omit<UpdateUserProfileInput, "userId" | ScalarField>
  & { [K in ScalarField]?: UpdateUserProfileInput[K] | null };

export function upsertUserProfile(
  userId: string,
  patch: UserProfilePatch
): UserProfile {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  const now = nowISO();
  const existing = row ? {
    goal: (row.goal as UserGoal | undefined) ?? undefined,
    customGoal: (row.custom_goal as string) || undefined,
    heightCm: (row.height_cm as number) ?? undefined,
    weightKg: (row.weight_kg as number) ?? undefined,
    age: (row.age as number) ?? undefined,
    gender: (row.gender as string) || undefined,
    activityLevel: (row.activity_level as ActivityLevel) || undefined,
    avoidFoods: parseJsonArray<string>(row.avoid_foods_json as string),
    preferences: parseJsonArray<string>(row.preferences_json as string),
    allergies: parseJsonArray<string>(row.allergies_json as string),
    medicalNotes: parseJsonArray<string>(row.medical_notes_json as string),
    createdAt: row.created_at as string,
  } : { createdAt: now };

  const merged: UserProfile = {
    ...existing,
    ...(patch.goal !== undefined ? { goal: patch.goal ?? undefined } : {}),
    ...(patch.customGoal !== undefined ? { customGoal: patch.customGoal ?? undefined } : {}),
    ...(patch.heightCm !== undefined ? { heightCm: patch.heightCm ?? undefined } : {}),
    ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg ?? undefined } : {}),
    ...(patch.age !== undefined ? { age: patch.age ?? undefined } : {}),
    ...(patch.gender !== undefined ? { gender: patch.gender ?? undefined } : {}),
    ...(patch.activityLevel !== undefined ? { activityLevel: patch.activityLevel ?? undefined } : {}),
    ...(patch.avoidFoods !== undefined ? { avoidFoods: patch.avoidFoods } : {}),
    ...(patch.preferences !== undefined ? { preferences: patch.preferences } : {}),
    ...(patch.allergies !== undefined ? { allergies: patch.allergies } : {}),
    ...(patch.medicalNotes !== undefined ? { medicalNotes: patch.medicalNotes } : {}),
    userId,
    updatedAt: nextUpdatedAt(row?.updated_at as string | undefined),
  };

  db.prepare(`
    INSERT INTO user_profiles (user_id, goal, custom_goal, height_cm, weight_kg, age, gender,
      activity_level, avoid_foods_json, preferences_json, allergies_json, medical_notes_json,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      goal = excluded.goal, custom_goal = excluded.custom_goal, height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg, age = excluded.age, gender = excluded.gender,
      activity_level = excluded.activity_level, avoid_foods_json = excluded.avoid_foods_json,
      preferences_json = excluded.preferences_json, allergies_json = excluded.allergies_json,
      medical_notes_json = excluded.medical_notes_json, updated_at = excluded.updated_at
  `).run(
    merged.userId, merged.goal ?? null, merged.customGoal ?? null, merged.heightCm ?? null,
    merged.weightKg ?? null, merged.age ?? null, merged.gender ?? null, merged.activityLevel ?? null,
    stringifyJson(merged.avoidFoods), stringifyJson(merged.preferences), stringifyJson(merged.allergies),
    stringifyJson(merged.medicalNotes), merged.createdAt, merged.updatedAt
  );
  return merged;
}

export function getUserProfile(userId: string): UserProfile | undefined {
  const row = getDatabase().prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
    userId: row.user_id as string,
    goal: (row.goal as UserGoal) || undefined,
    customGoal: (row.custom_goal as string) || undefined,
    heightCm: (row.height_cm as number) ?? undefined,
    weightKg: (row.weight_kg as number) ?? undefined,
    age: (row.age as number) ?? undefined,
    gender: (row.gender as string) || undefined,
    activityLevel: (row.activity_level as ActivityLevel) || undefined,
    avoidFoods: parseJsonArray<string>(row.avoid_foods_json as string),
    preferences: parseJsonArray<string>(row.preferences_json as string),
    allergies: parseJsonArray<string>(row.allergies_json as string),
    medicalNotes: parseJsonArray<string>(row.medical_notes_json as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
