import type { KitchenProfile } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { nextUpdatedAt, parseJsonArray, stringifyJson } from "../shared.js";

const defaults: Omit<KitchenProfile, "userId" | "updatedAt"> = {
  burners: 2,
  hasOven: true,
  hasMicrowave: false,
  hasRiceCooker: false,
  cookware: ["炒锅", "汤锅", "烤盘"],
  maxActiveMinutes: 20,
  maxTotalMinutes: 35,
  tastePreferences: [],
  cookingPreferences: ["快手", "少洗碗", "少油烟", "烤箱优先"],
};

export function upsertKitchenProfile(
  userId: string,
  patch: Partial<Omit<KitchenProfile, "userId" | "updatedAt">>
): KitchenProfile {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM kitchen_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  const existing = row ? {
    burners: row.burners as number,
    hasOven: !!row.has_oven,
    hasMicrowave: !!row.has_microwave,
    hasRiceCooker: !!row.has_rice_cooker,
    cookware: parseJsonArray<string>(row.cookware_json as string),
    maxActiveMinutes: row.max_active_minutes as number,
    maxTotalMinutes: row.max_total_minutes as number,
    tastePreferences: parseJsonArray<string>(row.taste_preferences_json as string),
    cookingPreferences: parseJsonArray<string>(row.cooking_preferences_json as string),
  } : undefined;
  const merged: KitchenProfile = { ...defaults, ...existing, ...patch, userId, updatedAt: nextUpdatedAt(row?.updated_at as string | undefined) };

  db.prepare(`
    INSERT INTO kitchen_profiles (user_id, burners, has_oven, has_microwave, has_rice_cooker,
      cookware_json, max_active_minutes, max_total_minutes, taste_preferences_json,
      cooking_preferences_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      burners = excluded.burners, has_oven = excluded.has_oven,
      has_microwave = excluded.has_microwave, has_rice_cooker = excluded.has_rice_cooker,
      cookware_json = excluded.cookware_json, max_active_minutes = excluded.max_active_minutes,
      max_total_minutes = excluded.max_total_minutes,
      taste_preferences_json = excluded.taste_preferences_json,
      cooking_preferences_json = excluded.cooking_preferences_json, updated_at = excluded.updated_at
  `).run(
    merged.userId, merged.burners, merged.hasOven ? 1 : 0, merged.hasMicrowave ? 1 : 0,
    merged.hasRiceCooker ? 1 : 0, stringifyJson(merged.cookware), merged.maxActiveMinutes,
    merged.maxTotalMinutes, stringifyJson(merged.tastePreferences),
    stringifyJson(merged.cookingPreferences), merged.updatedAt
  );
  return merged;
}

export function getKitchenProfile(userId: string): KitchenProfile {
  const row = getDatabase().prepare("SELECT * FROM kitchen_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return upsertKitchenProfile(userId, {});
  return {
    userId: row.user_id as string,
    burners: row.burners as number,
    hasOven: !!row.has_oven,
    hasMicrowave: !!row.has_microwave,
    hasRiceCooker: !!row.has_rice_cooker,
    cookware: parseJsonArray<string>(row.cookware_json as string),
    maxActiveMinutes: row.max_active_minutes as number,
    maxTotalMinutes: row.max_total_minutes as number,
    tastePreferences: parseJsonArray<string>(row.taste_preferences_json as string),
    cookingPreferences: parseJsonArray<string>(row.cooking_preferences_json as string),
    updatedAt: row.updated_at as string,
  };
}
