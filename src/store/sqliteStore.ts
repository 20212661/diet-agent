/**
 * SQLite 持久化存储模块
 *
 * 替代 memoryStore.ts 的 Map + Array 易失性存储。
 * 所有数据持久化到 data/diet-agent.sqlite。
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  UserProfile,
  UserGoal,
  ActivityLevel,
  MealLog,
  MealType,
  AddMealLogInput,
  UpdateUserProfileInput,
  TodaySummary,
  KitchenProfile,
  IngredientInventory,
  IngredientItem,
  CookingFeedback,
  RecipeRecord,
} from "../types/diet.js";
import { recipeBook } from "../recipes/recipeBook.js";

// ---- 路径工具 ----

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, "..", "..", "data");
const DB_PATH = join(DB_DIR, "diet-agent.sqlite");

// ---- 时间工具 ----

function nowISO(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function generateId(prefix = "rec"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ---- JSON 安全辅助 ----

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[] = []): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---- 数据库初始化 ----

function ensureDataDir(): void {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      goal TEXT,
      custom_goal TEXT,
      height_cm REAL,
      weight_kg REAL,
      age INTEGER,
      gender TEXT,
      activity_level TEXT,
      avoid_foods_json TEXT NOT NULL DEFAULT '[]',
      preferences_json TEXT NOT NULL DEFAULT '[]',
      allergies_json TEXT NOT NULL DEFAULT '[]',
      medical_notes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kitchen_profiles (
      user_id TEXT PRIMARY KEY,
      burners INTEGER NOT NULL DEFAULT 2,
      has_oven INTEGER NOT NULL DEFAULT 1,
      cookware_json TEXT NOT NULL DEFAULT '[]',
      max_active_minutes INTEGER NOT NULL DEFAULT 20,
      max_total_minutes INTEGER NOT NULL DEFAULT 35,
      taste_preferences_json TEXT NOT NULL DEFAULT '[]',
      cooking_preferences_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingredient_inventory (
      user_id TEXT PRIMARY KEY,
      available_ingredients_json TEXT NOT NULL DEFAULT '[]',
      shopping_list_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      foods_json TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(user_id, date);

    CREATE TABLE IF NOT EXISTS cooking_feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recipe_id TEXT,
      recipe_name TEXT,
      rating INTEGER,
      actual_active_minutes INTEGER,
      actual_total_minutes INTEGER,
      too_tiring INTEGER,
      too_many_dishes INTEGER,
      would_cook_again INTEGER,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cooking_feedback_user ON cooking_feedback(user_id);

    CREATE TABLE IF NOT EXISTS recipe_book (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      meal_types_json TEXT NOT NULL DEFAULT '[]',
      modes_json TEXT NOT NULL DEFAULT '[]',
      suitable_goals_json TEXT NOT NULL DEFAULT '[]',
      ingredients_json TEXT NOT NULL,
      optional_ingredients_json TEXT NOT NULL DEFAULT '[]',
      primary_protein TEXT,
      vegetables_json TEXT NOT NULL DEFAULT '[]',
      staples_json TEXT NOT NULL DEFAULT '[]',
      cookware_json TEXT NOT NULL,
      appliances_json TEXT NOT NULL DEFAULT '[]',
      active_minutes INTEGER NOT NULL,
      total_minutes INTEGER NOT NULL,
      difficulty INTEGER NOT NULL DEFAULT 2,
      dish_count INTEGER NOT NULL DEFAULT 2,
      steps_json TEXT NOT NULL,
      taste_tags_json TEXT NOT NULL DEFAULT '[]',
      preference_tags_json TEXT NOT NULL DEFAULT '[]',
      season_tags_json TEXT NOT NULL DEFAULT '[]',
      timeline_json TEXT NOT NULL DEFAULT '[]',
      low_energy_swap TEXT,
      weekend_prep TEXT,
      freezer_reuse TEXT,
      estimated_calories INTEGER,
      protein_level TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

/** 检查表中是否已有某列 */
function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as { name: string }[];
  return columns.some((col) => col.name === columnName);
}

/** 安全添加列（如已存在则跳过） */
function addColumnIfMissing(db: Database.Database, tableName: string, columnSql: string, columnName: string): void {
  if (!tableHasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
    console.log(`📦 迁移完成：${tableName} 新增 ${columnName} 字段`);
  }
}

/** 数据库迁移：检查并添加缺失的字段 */
function runMigrations(db: Database.Database): void {
  // 迁移 1：cooking_feedback 表新增 would_cook_again 字段
  if (!tableHasColumn(db, "cooking_feedback", "would_cook_again")) {
    db.exec("ALTER TABLE cooking_feedback ADD COLUMN would_cook_again INTEGER");
    console.log("📦 迁移完成：cooking_feedback 新增 would_cook_again 字段");
  }
}

/** recipe_book 表结构扩展迁移 */
function migrateRecipeBook(db: Database.Database): void {
  const t = "recipe_book";
  addColumnIfMissing(db, t, "meal_types_json TEXT NOT NULL DEFAULT '[]'", "meal_types_json");
  addColumnIfMissing(db, t, "modes_json TEXT NOT NULL DEFAULT '[]'", "modes_json");
  addColumnIfMissing(db, t, "suitable_goals_json TEXT NOT NULL DEFAULT '[]'", "suitable_goals_json");
  addColumnIfMissing(db, t, "primary_protein TEXT", "primary_protein");
  addColumnIfMissing(db, t, "vegetables_json TEXT NOT NULL DEFAULT '[]'", "vegetables_json");
  addColumnIfMissing(db, t, "staples_json TEXT NOT NULL DEFAULT '[]'", "staples_json");
  addColumnIfMissing(db, t, "appliances_json TEXT NOT NULL DEFAULT '[]'", "appliances_json");
  addColumnIfMissing(db, t, "difficulty INTEGER NOT NULL DEFAULT 2", "difficulty");
  addColumnIfMissing(db, t, "dish_count INTEGER NOT NULL DEFAULT 2", "dish_count");
  addColumnIfMissing(db, t, "taste_tags_json TEXT NOT NULL DEFAULT '[]'", "taste_tags_json");
  addColumnIfMissing(db, t, "preference_tags_json TEXT NOT NULL DEFAULT '[]'", "preference_tags_json");
  addColumnIfMissing(db, t, "season_tags_json TEXT NOT NULL DEFAULT '[]'", "season_tags_json");
  addColumnIfMissing(db, t, "timeline_json TEXT NOT NULL DEFAULT '[]'", "timeline_json");
  addColumnIfMissing(db, t, "weekend_prep TEXT", "weekend_prep");
  addColumnIfMissing(db, t, "freezer_reuse TEXT", "freezer_reuse");
  addColumnIfMissing(db, t, "estimated_calories INTEGER", "estimated_calories");
  addColumnIfMissing(db, t, "protein_level TEXT", "protein_level");
}

/** 将内置 recipeBook 种子数据写入数据库（upsert），覆盖全部结构化字段 */
function seedRecipeBook(db: Database.Database): void {
  const upsert = db.prepare(`
    INSERT INTO recipe_book (
      id, name, mode,
      meal_types_json, modes_json, suitable_goals_json,
      ingredients_json, optional_ingredients_json,
      primary_protein, vegetables_json, staples_json,
      cookware_json, appliances_json,
      active_minutes, total_minutes, difficulty, dish_count,
      steps_json, taste_tags_json, preference_tags_json, season_tags_json, timeline_json,
      low_energy_swap, weekend_prep, freezer_reuse,
      estimated_calories, protein_level, updated_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mode = excluded.mode,
      meal_types_json = excluded.meal_types_json,
      modes_json = excluded.modes_json,
      suitable_goals_json = excluded.suitable_goals_json,
      ingredients_json = excluded.ingredients_json,
      optional_ingredients_json = excluded.optional_ingredients_json,
      primary_protein = excluded.primary_protein,
      vegetables_json = excluded.vegetables_json,
      staples_json = excluded.staples_json,
      cookware_json = excluded.cookware_json,
      appliances_json = excluded.appliances_json,
      active_minutes = excluded.active_minutes,
      total_minutes = excluded.total_minutes,
      difficulty = excluded.difficulty,
      dish_count = excluded.dish_count,
      steps_json = excluded.steps_json,
      taste_tags_json = excluded.taste_tags_json,
      preference_tags_json = excluded.preference_tags_json,
      season_tags_json = excluded.season_tags_json,
      timeline_json = excluded.timeline_json,
      low_energy_swap = excluded.low_energy_swap,
      weekend_prep = excluded.weekend_prep,
      freezer_reuse = excluded.freezer_reuse,
      estimated_calories = excluded.estimated_calories,
      protein_level = excluded.protein_level,
      updated_at = excluded.updated_at
  `);

  const now = nowISO();
  const insertMany = db.transaction((recipes: typeof recipeBook) => {
    for (const r of recipes) {
      upsert.run(
        r.id,
        r.name,
        r.mode ?? r.modes?.[0] ?? "quick",
        stringifyJson(r.mealTypes ?? []),
        stringifyJson(r.modes ?? [r.mode ?? "quick"]),
        stringifyJson(r.suitableGoals ?? []),
        stringifyJson(r.ingredients),
        stringifyJson(r.optionalIngredients ?? []),
        r.primaryProtein ?? null,
        stringifyJson(r.vegetables ?? []),
        stringifyJson(r.staples ?? []),
        stringifyJson(r.cookware),
        stringifyJson(r.appliances ?? []),
        r.activeMinutes,
        r.totalMinutes,
        r.difficulty ?? 2,
        r.dishCount ?? 2,
        stringifyJson(r.steps),
        stringifyJson(r.tasteTags ?? []),
        stringifyJson(r.preferenceTags ?? []),
        stringifyJson(r.seasonTags ?? []),
        stringifyJson(r.timeline ?? []),
        r.lowEnergySwap ?? null,
        r.weekendPrep ?? null,
        r.freezerReuse ?? null,
        r.estimatedCalories ?? null,
        r.proteinLevel ?? null,
        now
      );
    }
  });

  insertMany(recipeBook);
}

// ---- 全局单例 ----

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  ensureDataDir();
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  createTables(_db);
  runMigrations(_db);
  migrateRecipeBook(_db);
  seedRecipeBook(_db);
  return _db;
}

// 在模块加载时初始化
getDb();
console.log(`📦 SQLite 存储已初始化: ${DB_PATH}`);

// ==================================================================
// 导出的存储接口 — 与 memoryStore 完全兼容
// ==================================================================

// ---- 用户画像 ----

export function upsertUserProfile(
  userId: string,
  patch: Omit<UpdateUserProfileInput, "userId">
): UserProfile {
  const db = getDb();

  // 先读取已有记录
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;

  const now = nowISO();
  const existing = row
    ? {
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
      }
    : { createdAt: now };

  const merged: UserProfile = {
    ...existing,
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.customGoal !== undefined ? { customGoal: patch.customGoal } : {}),
    ...(patch.heightCm !== undefined ? { heightCm: patch.heightCm } : {}),
    ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
    ...(patch.age !== undefined ? { age: patch.age } : {}),
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.activityLevel !== undefined ? { activityLevel: patch.activityLevel } : {}),
    ...(patch.avoidFoods !== undefined ? { avoidFoods: patch.avoidFoods } : {}),
    ...(patch.preferences !== undefined ? { preferences: patch.preferences } : {}),
    ...(patch.allergies !== undefined ? { allergies: patch.allergies } : {}),
    ...(patch.medicalNotes !== undefined ? { medicalNotes: patch.medicalNotes } : {}),
    userId,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO user_profiles (user_id, goal, custom_goal, height_cm, weight_kg, age, gender,
      activity_level, avoid_foods_json, preferences_json, allergies_json, medical_notes_json,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      goal = excluded.goal,
      custom_goal = excluded.custom_goal,
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      age = excluded.age,
      gender = excluded.gender,
      activity_level = excluded.activity_level,
      avoid_foods_json = excluded.avoid_foods_json,
      preferences_json = excluded.preferences_json,
      allergies_json = excluded.allergies_json,
      medical_notes_json = excluded.medical_notes_json,
      updated_at = excluded.updated_at
  `).run(
    merged.userId,
    merged.goal ?? null,
    merged.customGoal ?? null,
    merged.heightCm ?? null,
    merged.weightKg ?? null,
    merged.age ?? null,
    merged.gender ?? null,
    merged.activityLevel ?? null,
    stringifyJson(merged.avoidFoods),
    stringifyJson(merged.preferences),
    stringifyJson(merged.allergies),
    stringifyJson(merged.medicalNotes),
    merged.createdAt,
    merged.updatedAt
  );

  return merged;
}

export function getUserProfile(userId: string): UserProfile | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
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

// ---- 厨房画像 ----

export function upsertKitchenProfile(
  userId: string,
  patch: Partial<Omit<KitchenProfile, "userId" | "updatedAt">>
): KitchenProfile {
  const db = getDb();

  const row = db.prepare("SELECT * FROM kitchen_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;

  const existing = row
    ? {
        burners: row.burners as number,
        hasOven: !!row.has_oven,
        cookware: parseJsonArray<string>(row.cookware_json as string),
        maxActiveMinutes: row.max_active_minutes as number,
        maxTotalMinutes: row.max_total_minutes as number,
        tastePreferences: parseJsonArray<string>(row.taste_preferences_json as string),
        cookingPreferences: parseJsonArray<string>(row.cooking_preferences_json as string),
      }
    : null;

  const defaults: Omit<KitchenProfile, "userId" | "updatedAt"> = {
    burners: 2,
    hasOven: true,
    cookware: ["炒锅", "汤锅", "烤盘"],
    maxActiveMinutes: 20,
    maxTotalMinutes: 35,
    tastePreferences: [],
    cookingPreferences: ["快手", "少洗碗", "少油烟", "烤箱优先"],
  };

  const merged: KitchenProfile = {
    ...defaults,
    ...existing,
    ...patch,
    userId,
    updatedAt: nowISO(),
  };

  db.prepare(`
    INSERT INTO kitchen_profiles (user_id, burners, has_oven, cookware_json, max_active_minutes,
      max_total_minutes, taste_preferences_json, cooking_preferences_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      burners = excluded.burners,
      has_oven = excluded.has_oven,
      cookware_json = excluded.cookware_json,
      max_active_minutes = excluded.max_active_minutes,
      max_total_minutes = excluded.max_total_minutes,
      taste_preferences_json = excluded.taste_preferences_json,
      cooking_preferences_json = excluded.cooking_preferences_json,
      updated_at = excluded.updated_at
  `).run(
    merged.userId,
    merged.burners,
    merged.hasOven ? 1 : 0,
    stringifyJson(merged.cookware),
    merged.maxActiveMinutes,
    merged.maxTotalMinutes,
    stringifyJson(merged.tastePreferences),
    stringifyJson(merged.cookingPreferences),
    merged.updatedAt
  );

  return merged;
}

export function getKitchenProfile(userId: string): KitchenProfile {
  const db = getDb();
  const row = db.prepare("SELECT * FROM kitchen_profiles WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return upsertKitchenProfile(userId, {});

  return {
    userId: row.user_id as string,
    burners: row.burners as number,
    hasOven: !!row.has_oven,
    cookware: parseJsonArray<string>(row.cookware_json as string),
    maxActiveMinutes: row.max_active_minutes as number,
    maxTotalMinutes: row.max_total_minutes as number,
    tastePreferences: parseJsonArray<string>(row.taste_preferences_json as string),
    cookingPreferences: parseJsonArray<string>(row.cooking_preferences_json as string),
    updatedAt: row.updated_at as string,
  };
}

// ---- 食材库存 ----

function toIngredientItems(items: string[] | IngredientItem[] | undefined): IngredientItem[] {
  if (!items) return [];
  return items.map((item) => {
    if (typeof item === "string") return { name: item, status: "available" };
    return ensureItemDefaults(item);
  });
}

/** 补充默认字段 */
function ensureItemDefaults(item: IngredientItem): IngredientItem {
  return {
    ...item,
    id: item.id || generateId("ing"),
    status: item.status || "available",
    expiresSoon: computeExpiresSoon(item),
  };
}

/** 判断是否快过期（3天内或已过期） */
function computeExpiresSoon(item: IngredientItem): boolean {
  if (!item.expiresAt) return false;
  const today = todayDate();
  const diff = (new Date(item.expiresAt).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
  return diff <= 3;
}

/** 按 name+storage 去重，后来的合并覆盖前面的非空字段 */
function dedupeIngredients(items: IngredientItem[]): IngredientItem[] {
  const map = new Map<string, IngredientItem>();
  for (const item of items) {
    const key = `${item.name}|${item.storage || "unknown"}`;
    const existing = map.get(key);
    if (existing) {
      // 合并：新记录覆盖旧记录的非空字段
      map.set(key, mergeItems(existing, item));
    } else {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

/** 合并两个 IngredientItem，新值覆盖旧值的非空字段 */
function mergeItems(base: IngredientItem, patch: IngredientItem): IngredientItem {
  const result: IngredientItem = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null && v !== "") {
      (result as unknown as Record<string, unknown>)[k] = v;
    }
  }
  result.expiresSoon = computeExpiresSoon(result);
  return result;
}

export function upsertIngredientInventory(
  userId: string,
  patch: {
    availableIngredients?: string[] | IngredientItem[];
    shoppingList?: string[] | IngredientItem[];
    replaceAvailable?: boolean;
    replaceShoppingList?: boolean;
  }
): IngredientInventory {
  const db = getDb();

  const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;

  const existingAvailable = row
    ? parseJsonArray<IngredientItem>(row.available_ingredients_json as string)
    : [];
  const existingShopping = row
    ? parseJsonArray<IngredientItem>(row.shopping_list_json as string)
    : [];

  const availablePatch = toIngredientItems(patch.availableIngredients);
  const shoppingPatch = toIngredientItems(patch.shoppingList);

  const finalAvailable = patch.replaceAvailable
    ? dedupeIngredients(availablePatch)
    : dedupeIngredients([...existingAvailable, ...availablePatch]);

  const finalShopping = patch.replaceShoppingList
    ? dedupeIngredients(shoppingPatch)
    : dedupeIngredients([...existingShopping, ...shoppingPatch]);

  const now = nowISO();

  db.prepare(`
    INSERT INTO ingredient_inventory (user_id, available_ingredients_json, shopping_list_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      available_ingredients_json = excluded.available_ingredients_json,
      shopping_list_json = excluded.shopping_list_json,
      updated_at = excluded.updated_at
  `).run(userId, stringifyJson(finalAvailable), stringifyJson(finalShopping), now);

  return {
    userId,
    availableIngredients: finalAvailable,
    shoppingList: finalShopping,
    updatedAt: now,
  };
}

export function getIngredientInventory(userId: string): IngredientInventory {
  const db = getDb();
  const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    return {
      userId,
      availableIngredients: [],
      shoppingList: [],
      updatedAt: nowISO(),
    };
  }

  return {
    userId: row.user_id as string,
    availableIngredients: parseJsonArray<IngredientItem>(row.available_ingredients_json as string).map(ensureItemDefaults),
    shoppingList: parseJsonArray<IngredientItem>(row.shopping_list_json as string).map(ensureItemDefaults),
    updatedAt: row.updated_at as string,
  };
}

/** 更新单个食材的状态（如标记用完、过期、丢弃） */
export function updateIngredientStatus(
  userId: string,
  itemName: string,
  status: IngredientItem["status"],
  note?: string
): IngredientItem | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;

  const available = parseJsonArray<IngredientItem>(row.available_ingredients_json as string);
  const shopping = parseJsonArray<IngredientItem>(row.shopping_list_json as string);

  let updated: IngredientItem | null = null;

  // 先在已有食材里找
  for (const item of available) {
    if (item.name === itemName || item.name.includes(itemName) || itemName.includes(item.name)) {
      item.status = status;
      if (note) item.note = note;
      updated = item;
    }
  }
  // 再在购物清单里找
  if (!updated) {
    for (const item of shopping) {
      if (item.name === itemName || item.name.includes(itemName) || itemName.includes(item.name)) {
        item.status = status;
        if (note) item.note = note;
        updated = item;
      }
    }
  }

  if (updated) {
    const now = nowISO();
    db.prepare(`
      UPDATE ingredient_inventory SET available_ingredients_json = ?, shopping_list_json = ?, updated_at = ?
      WHERE user_id = ?
    `).run(stringifyJson(available), stringifyJson(shopping), now, userId);
  }

  return updated;
}

// ---- 饮食记录 ----

export function addMealLog(input: AddMealLogInput): MealLog {
  const db = getDb();
  const { userId, mealType, foods, note } = input;
  const now = nowISO();
  const date = todayDate();
  const id = generateId("meal");

  const entry: MealLog = {
    id,
    userId,
    date,
    mealType,
    foods,
    note,
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO meal_logs (id, user_id, date, meal_type, foods_json, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, date, mealType, stringifyJson(foods), note ?? null, now);

  return entry;
}

export function getMealLogsByDate(userId: string, date?: string): MealLog[] {
  const db = getDb();
  const targetDate = date ?? todayDate();
  const rows = db
    .prepare("SELECT * FROM meal_logs WHERE user_id = ? AND date = ? ORDER BY created_at")
    .all(userId, targetDate) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    date: row.date as string,
    mealType: row.meal_type as MealType,
    foods: parseJsonArray<MealLog["foods"][0]>(row.foods_json as string),
    note: (row.note as string) || undefined,
    createdAt: row.created_at as string,
  }));
}

export function getAllMealLogs(userId: string): MealLog[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM meal_logs WHERE user_id = ? ORDER BY date DESC, created_at")
    .all(userId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    date: row.date as string,
    mealType: row.meal_type as MealType,
    foods: parseJsonArray<MealLog["foods"][0]>(row.foods_json as string),
    note: (row.note as string) || undefined,
    createdAt: row.created_at as string,
  }));
}

export function getTodaySummary(userId: string, date?: string): TodaySummary {
  const targetDate = date ?? todayDate();
  const meals = getMealLogsByDate(userId, targetDate);

  const estimatedTotalCalories = meals.reduce((sum, meal) => {
    return (
      sum +
      meal.foods.reduce((s, f) => s + (f.estimatedCalories ?? 0), 0)
    );
  }, 0);

  const mealTypeLabel: Record<string, string> = {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "加餐",
    unknown: "其他",
  };

  const lines: string[] = [];
  if (meals.length === 0) {
    lines.push(`${targetDate} 暂无饮食记录。`);
  } else {
    lines.push(`${targetDate} 共记录 ${meals.length} 餐：`);
    for (const meal of meals) {
      const typeLabel = mealTypeLabel[meal.mealType] ?? meal.mealType;
      const foodDesc = meal.foods
        .map((f) => `${f.name}${f.amount ? " " + f.amount : ""}`)
        .join("、");
      const cal = meal.foods.reduce(
        (s, f) => s + (f.estimatedCalories ?? 0),
        0
      );
      lines.push(
        `- ${typeLabel}: ${foodDesc}（约 ${cal} kcal，粗略估算）`
      );
    }
    lines.push(
      `\n当日合计粗略估算热量: 约 ${estimatedTotalCalories} kcal`
    );
  }

  return {
    userId,
    date: targetDate,
    meals,
    estimatedTotalCalories,
    summaryText: lines.join("\n"),
  };
}

// ---- 做饭反馈 ----

export function addCookingFeedback(input: {
  userId: string;
  recipeId?: string;
  recipeName?: string;
  rating?: number;
  actualActiveMinutes?: number;
  actualTotalMinutes?: number;
  tooTiring?: boolean;
  tooManyDishes?: boolean;
  wouldCookAgain?: boolean;
  note?: string;
}): CookingFeedback {
  const db = getDb();
  const id = generateId("fb");
  const now = nowISO();

  const entry: CookingFeedback = {
    id,
    userId: input.userId,
    recipeId: input.recipeId,
    recipeName: input.recipeName,
    rating: input.rating,
    actualActiveMinutes: input.actualActiveMinutes,
    actualTotalMinutes: input.actualTotalMinutes,
    tooTiring: input.tooTiring,
    tooManyDishes: input.tooManyDishes,
    wouldCookAgain: input.wouldCookAgain,
    note: input.note,
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO cooking_feedback (id, user_id, recipe_id, recipe_name, rating,
      actual_active_minutes, actual_total_minutes, too_tiring, too_many_dishes,
      would_cook_again, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.userId,
    entry.recipeId ?? null,
    entry.recipeName ?? null,
    entry.rating ?? null,
    entry.actualActiveMinutes ?? null,
    entry.actualTotalMinutes ?? null,
    entry.tooTiring ? 1 : 0,
    entry.tooManyDishes ? 1 : 0,
    entry.wouldCookAgain == null ? null : entry.wouldCookAgain ? 1 : 0,
    entry.note ?? null,
    now
  );

  return entry;
}

export function getCookingFeedback(userId: string): CookingFeedback[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM cooking_feedback WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Record<string, unknown>[];

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

// ---- 菜谱 ----

export function getRecipeBook(): RecipeRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM recipe_book ORDER BY name").all() as Record<string, unknown>[];

  return rows.map((row) => {
    const mode = row.mode as string;
    const modes = parseJsonArray<string>(row.modes_json as string);
    return {
      id: row.id as string,
      name: row.name as string,
      mode,
      mealTypes: parseJsonArray<string>(row.meal_types_json as string) as RecipeRecord["mealTypes"],
      modes: (modes.length > 0 ? modes : [mode]) as RecipeRecord["modes"],
      suitableGoals: parseJsonArray<string>(row.suitable_goals_json as string),
      ingredients: parseJsonArray<string>(row.ingredients_json as string),
      optionalIngredients: parseJsonArray<string>(row.optional_ingredients_json as string),
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
      seasonTags: parseJsonArray<string>(row.season_tags_json as string).length > 0
        ? parseJsonArray<string>(row.season_tags_json as string)
        : undefined,
      timeline: parseJsonArray<string>(row.timeline_json as string).length > 0
        ? parseJsonArray<string>(row.timeline_json as string)
        : undefined,
      lowEnergySwap: (row.low_energy_swap as string) || undefined,
      weekendPrep: (row.weekend_prep as string) || undefined,
      freezerReuse: (row.freezer_reuse as string) || undefined,
      estimatedCalories: (row.estimated_calories as number) ?? undefined,
      proteinLevel: (row.protein_level as RecipeRecord["proteinLevel"]) || undefined,
      updatedAt: row.updated_at as string,
    };
  });
}

export function upsertRecipe(recipe: Omit<RecipeRecord, "updatedAt">): RecipeRecord {
  const db = getDb();
  const now = nowISO();
  const mode = recipe.mode ?? recipe.modes?.[0] ?? "quick";

  db.prepare(`
    INSERT INTO recipe_book (
      id, name, mode,
      meal_types_json, modes_json, suitable_goals_json,
      ingredients_json, optional_ingredients_json,
      primary_protein, vegetables_json, staples_json,
      cookware_json, appliances_json,
      active_minutes, total_minutes, difficulty, dish_count,
      steps_json, taste_tags_json, preference_tags_json, season_tags_json, timeline_json,
      low_energy_swap, weekend_prep, freezer_reuse,
      estimated_calories, protein_level, updated_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mode = excluded.mode,
      meal_types_json = excluded.meal_types_json,
      modes_json = excluded.modes_json,
      suitable_goals_json = excluded.suitable_goals_json,
      ingredients_json = excluded.ingredients_json,
      optional_ingredients_json = excluded.optional_ingredients_json,
      primary_protein = excluded.primary_protein,
      vegetables_json = excluded.vegetables_json,
      staples_json = excluded.staples_json,
      cookware_json = excluded.cookware_json,
      appliances_json = excluded.appliances_json,
      active_minutes = excluded.active_minutes,
      total_minutes = excluded.total_minutes,
      difficulty = excluded.difficulty,
      dish_count = excluded.dish_count,
      steps_json = excluded.steps_json,
      taste_tags_json = excluded.taste_tags_json,
      preference_tags_json = excluded.preference_tags_json,
      season_tags_json = excluded.season_tags_json,
      timeline_json = excluded.timeline_json,
      low_energy_swap = excluded.low_energy_swap,
      weekend_prep = excluded.weekend_prep,
      freezer_reuse = excluded.freezer_reuse,
      estimated_calories = excluded.estimated_calories,
      protein_level = excluded.protein_level,
      updated_at = excluded.updated_at
  `).run(
    recipe.id,
    recipe.name,
    mode,
    stringifyJson(recipe.mealTypes ?? []),
    stringifyJson(recipe.modes ?? [mode]),
    stringifyJson(recipe.suitableGoals ?? []),
    stringifyJson(recipe.ingredients),
    stringifyJson(recipe.optionalIngredients),
    recipe.primaryProtein ?? null,
    stringifyJson(recipe.vegetables ?? []),
    stringifyJson(recipe.staples ?? []),
    stringifyJson(recipe.cookware),
    stringifyJson(recipe.appliances ?? []),
    recipe.activeMinutes,
    recipe.totalMinutes,
    recipe.difficulty ?? 2,
    recipe.dishCount ?? 2,
    stringifyJson(recipe.steps),
    stringifyJson(recipe.tasteTags ?? []),
    stringifyJson(recipe.preferenceTags ?? []),
    stringifyJson(recipe.seasonTags ?? []),
    stringifyJson(recipe.timeline ?? []),
    recipe.lowEnergySwap ?? null,
    recipe.weekendPrep ?? null,
    recipe.freezerReuse ?? null,
    recipe.estimatedCalories ?? null,
    recipe.proteinLevel ?? null,
    now
  );

  return { ...recipe, updatedAt: now };
}

// ---- 清除用户数据 ----

export function clearUserData(userId: string): void {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM kitchen_profiles WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM ingredient_inventory WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM meal_logs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM cooking_feedback WHERE user_id = ?").run(userId);
  });
  del();
}
