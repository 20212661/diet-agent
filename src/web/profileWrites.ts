import * as store from "../store/index.js";
import { WebWriteConflictError } from "./writeOnce.js";
import { optionalEnum, optionalText, optionalNumber, stringList, ingredientList } from "./payloadValidation.js";

/** Missing leaves a field unchanged; an explicitly empty value clears it. */
function clearable<T>(raw: unknown, parsed: T | undefined): T | null | undefined {
  return raw === undefined ? undefined : parsed ?? null;
}

export function saveProfile(userId: string, payload: Record<string, unknown>): void {
  const current = store.getUserProfile(userId);
  if (typeof payload.updatedAt !== "string" || payload.updatedAt !== (current?.updatedAt ?? "")) {
    throw new WebWriteConflictError("饮食资料已被其他操作修改，请刷新后核对再保存。");
  }
  const goals = ["fat_loss", "muscle_gain", "maintain", "healthier_eating", "custom"];
  const activityLevels = ["low", "medium", "high"];
  const goal = optionalEnum(payload.goal, goals, "饮食目标");
  const activityLevel = optionalEnum(payload.activityLevel, activityLevels, "活动水平");
  store.upsertUserProfile(userId, {
    goal: clearable(payload.goal, goal as "fat_loss" | "muscle_gain" | "maintain" | "healthier_eating" | "custom" | undefined),
    activityLevel: clearable(payload.activityLevel, activityLevel as "low" | "medium" | "high" | undefined),
    customGoal: clearable(payload.customGoal, optionalText(payload.customGoal, "自定义目标") || undefined),
    heightCm: clearable(payload.heightCm, optionalNumber(payload.heightCm, "身高", 50, 260)),
    weightKg: clearable(payload.weightKg, optionalNumber(payload.weightKg, "体重", 10, 500)),
    age: clearable(payload.age, optionalNumber(payload.age, "年龄", 1, 120)),
    gender: clearable(payload.gender, optionalText(payload.gender, "性别") || undefined),
    avoidFoods: stringList(payload.avoidFoods, "忌口"),
    preferences: stringList(payload.preferences, "口味偏好"),
    allergies: stringList(payload.allergies, "过敏信息"),
    medicalNotes: stringList(payload.medicalNotes, "健康备注"),
  });
}

export function saveKitchen(userId: string, payload: Record<string, unknown>): void {
  const current = store.getKitchenProfile(userId);
  if (typeof payload.updatedAt !== "string" || payload.updatedAt !== current.updatedAt) {
    throw new WebWriteConflictError("厨房设置已被其他操作修改，请刷新后核对再保存。");
  }
  const burners = optionalNumber(payload.burners, "灶台数量", 0, 20);
  const maxActiveMinutes = optionalNumber(payload.maxActiveMinutes, "主动操作时间", 1, 480);
  const maxTotalMinutes = optionalNumber(payload.maxTotalMinutes, "总耗时", 1, 720);
  for (const key of ["hasOven", "hasMicrowave", "hasRiceCooker"] as const) {
    if (payload[key] !== undefined && typeof payload[key] !== "boolean") throw new Error("厨房设备选项无效。");
  }
  store.upsertKitchenProfile(userId, {
    ...(burners !== undefined ? { burners } : {}),
    ...(payload.hasOven !== undefined ? { hasOven: payload.hasOven as boolean } : {}),
    ...(payload.hasMicrowave !== undefined ? { hasMicrowave: payload.hasMicrowave as boolean } : {}),
    ...(payload.hasRiceCooker !== undefined ? { hasRiceCooker: payload.hasRiceCooker as boolean } : {}),
    ...(maxActiveMinutes !== undefined ? { maxActiveMinutes } : {}),
    ...(maxTotalMinutes !== undefined ? { maxTotalMinutes } : {}),
    ...(payload.cookware !== undefined ? { cookware: stringList(payload.cookware, "厨具") } : {}),
    ...(payload.tastePreferences !== undefined ? { tastePreferences: stringList(payload.tastePreferences, "口味偏好") } : {}),
    ...(payload.cookingPreferences !== undefined ? { cookingPreferences: stringList(payload.cookingPreferences, "做饭偏好") } : {}),
  });
}

export function saveInventory(userId: string, payload: Record<string, unknown>): void {
  if (typeof payload.updatedAt !== "string" || !payload.updatedAt) {
    throw new Error("缺少读取库存时的 updatedAt，请刷新后重试。");
  }
  const availableIngredients = ingredientList(payload.availableIngredients, "现有食材");
  const shoppingList = ingredientList(payload.shoppingList, "采购清单");
  const result = store.replaceIngredientInventoryIfCurrent(userId, payload.updatedAt, availableIngredients, shoppingList);
  if (result.status === "conflict") {
    throw new WebWriteConflictError("库存已被其他操作修改，请刷新后核对整表内容。");
  }
}

