/**
 * 内存存储模块
 *
 * 第一版使用 Map + Array 实现内存存储。
 * 后续可替换为真实数据库实现，只需保持接口不变。
 */

import type {
  UserProfile,
  MealLog,
  AddMealLogInput,
  UpdateUserProfileInput,
  TodaySummary,
  KitchenProfile,
  IngredientInventory,
  IngredientItem,
} from "../types/diet.js";

// ---- 简单 ID 生成 ----
function generateId(): string {
  // 使用时间戳 + 随机数生成唯一 ID
  return `meal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** 获取当前日期 YYYY-MM-DD */
function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 当前 ISO 时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

// ---- 内存数据结构 ----
const profiles = new Map<string, UserProfile>();
const mealLogs = new Map<string, MealLog[]>(); // userId -> MealLog[]
const kitchenProfiles = new Map<string, KitchenProfile>();
const ingredientInventories = new Map<string, IngredientInventory>();

// ---- 导出的存储接口 ----

/**
 * 新建或更新用户画像（合并字段）
 */
export function upsertUserProfile(
  userId: string,
  patch: Omit<UpdateUserProfileInput, "userId">
): UserProfile {
  const existing = profiles.get(userId);
  const now = nowISO();

  const updated: UserProfile = {
    ...(existing ?? {
      userId,
      createdAt: now,
    }),
    ...patch,
    userId,
    updatedAt: now,
  };

  profiles.set(userId, updated);
  return updated;
}

/**
 * 获取用户画像
 */
export function getUserProfile(userId: string): UserProfile | undefined {
  return profiles.get(userId);
}

export function upsertKitchenProfile(
  userId: string,
  patch: Partial<Omit<KitchenProfile, "userId" | "updatedAt">>
): KitchenProfile {
  const existing = kitchenProfiles.get(userId);
  const updated: KitchenProfile = {
    userId,
    burners: 2,
    hasOven: true,
    cookware: ["炒锅", "汤锅", "烤盘"],
    maxActiveMinutes: 20,
    maxTotalMinutes: 35,
    tastePreferences: [],
    cookingPreferences: ["快手", "少洗碗", "少油烟", "烤箱优先"],
    ...(existing ?? {}),
    ...patch,
    updatedAt: nowISO(),
  };

  kitchenProfiles.set(userId, updated);
  return updated;
}

export function getKitchenProfile(userId: string): KitchenProfile {
  return kitchenProfiles.get(userId) ?? upsertKitchenProfile(userId, {});
}

function toIngredientItems(items: string[] | IngredientItem[] | undefined): IngredientItem[] {
  if (!items) return [];
  return items.map((item) =>
    typeof item === "string" ? { name: item } : item
  );
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
  const existing = ingredientInventories.get(userId);
  const availablePatch = toIngredientItems(patch.availableIngredients);
  const shoppingPatch = toIngredientItems(patch.shoppingList);

  const updated: IngredientInventory = {
    userId,
    availableIngredients: patch.replaceAvailable
      ? availablePatch
      : [...(existing?.availableIngredients ?? []), ...availablePatch],
    shoppingList: patch.replaceShoppingList
      ? shoppingPatch
      : [...(existing?.shoppingList ?? []), ...shoppingPatch],
    updatedAt: nowISO(),
  };

  ingredientInventories.set(userId, updated);
  return updated;
}

export function getIngredientInventory(userId: string): IngredientInventory {
  return ingredientInventories.get(userId) ?? {
    userId,
    availableIngredients: [],
    shoppingList: [],
    updatedAt: nowISO(),
  };
}

/**
 * 添加一餐记录
 */
export function addMealLog(input: AddMealLogInput): MealLog {
  const { userId, mealType, foods, note } = input;
  const now = nowISO();
  const date = todayDate();

  const entry: MealLog = {
    id: generateId(),
    userId,
    date,
    mealType,
    foods,
    note,
    createdAt: now,
  };

  const list = mealLogs.get(userId) ?? [];
  list.push(entry);
  mealLogs.set(userId, list);

  return entry;
}

/**
 * 按日期查询饮食记录
 */
export function getMealLogsByDate(userId: string, date?: string): MealLog[] {
  const targetDate = date ?? todayDate();
  const list = mealLogs.get(userId) ?? [];
  return list.filter((m) => m.date === targetDate);
}

/**
 * 获取用户全部饮食记录
 */
export function getAllMealLogs(userId: string): MealLog[] {
  return mealLogs.get(userId) ?? [];
}

/**
 * 生成今日饮食总结
 */
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

/**
 * 清除用户全部数据
 */
export function clearUserData(userId: string): void {
  profiles.delete(userId);
  mealLogs.delete(userId);
  kitchenProfiles.delete(userId);
  ingredientInventories.delete(userId);
}
