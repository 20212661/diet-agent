import type { IncomingMessage } from "node:http";
import type { IngredientItem, MealFood, MealType } from "../types/diet.js";
import { isValidIsoDate } from "../utils/date.js";

export function parseMealPayload(payload: Record<string, unknown>, requireCreate: boolean): {
  date?: string; mealType?: MealType; foods?: MealFood[]; note?: string;
} {
  const allowed = new Set(["operationId", "date", "mealType", "foods", "note"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("饮食记录包含不支持的字段。");
  const result: { date?: string; mealType?: MealType; foods?: MealFood[]; note?: string } = {};
  if (payload.date !== undefined) {
    if (typeof payload.date !== "string" || !isValidIsoDate(payload.date)) throw new Error("日期必须是有效的 YYYY-MM-DD 日期。");
    result.date = payload.date;
  }
  if (payload.mealType !== undefined) {
    const mealTypes = ["breakfast", "lunch", "dinner", "snack", "unknown"];
    if (typeof payload.mealType !== "string" || !mealTypes.includes(payload.mealType)) throw new Error("餐次无效。");
    result.mealType = payload.mealType as MealType;
  } else if (requireCreate) throw new Error("请指定餐次。");
  if (payload.foods !== undefined) {
    if (!Array.isArray(payload.foods) || payload.foods.length < 1 || payload.foods.length > 50) throw new Error("食物列表必须包含 1 到 50 项。");
    result.foods = payload.foods.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("食物项目格式无效。");
      const food = raw as Record<string, unknown>;
      if (Object.keys(food).some((key) => !["name", "amount", "note"].includes(key))) throw new Error("食物项目包含不支持的字段。");
      if (typeof food.name !== "string" || !food.name.trim() || food.name.length > 100) throw new Error("食物名称必填，最多 100 个字符。");
      if (food.amount !== undefined && (typeof food.amount !== "string" || food.amount.length > 100)) throw new Error("份量格式无效。");
      if (food.note !== undefined && (typeof food.note !== "string" || food.note.length > 300)) throw new Error("食物备注格式无效。");
      return { name: food.name.trim(), amount: (food.amount as string | undefined)?.trim() ?? "", ...(typeof food.note === "string" ? { note: food.note } : {}) };
    });
  } else if (requireCreate) throw new Error("至少填写一项食物。");
  if (payload.note !== undefined) {
    if (typeof payload.note !== "string" || payload.note.length > 1000) throw new Error("备注最多 1000 个字符。");
    result.note = payload.note;
  }
  return result;
}

export function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 500) throw new Error(`${label}格式无效。`);
  return value.trim();
}

export function optionalNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}应在 ${min} 到 ${max} 之间。`);
  return number;
}

export function optionalEnum(value: unknown, allowed: string[], label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label}选项无效。`);
  return value;
}

export function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 200)) {
    throw new Error(`${label}格式无效。`);
  }
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

export function ingredientList(value: unknown, label: string): IngredientItem[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label}最多保存 100 项。`);
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label}格式无效。`);
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 100) throw new Error(`${label}需要填写食材名称。`);
    const allowed = ["name", "id", "amount", "unit", "category", "storage", "status", "expiresAt", "purchasedAt", "note"];
    if (Object.keys(item).some((key) => !allowed.includes(key))) throw new Error(`${label}包含不支持的字段。`);
    const enumValues: Record<string, string[]> = {
      category: ["protein", "vegetable", "staple", "seasoning", "dairy", "fruit", "other"],
      storage: ["fridge", "freezer", "pantry", "room_temp"],
      status: ["available", "planned", "used", "expired", "discarded"],
    };
    for (const [key, values] of Object.entries(enumValues)) {
      if (item[key] !== undefined && (typeof item[key] !== "string" || !values.includes(item[key] as string))) {
        throw new Error(`${label}的${key}字段无效。`);
      }
    }
    for (const key of ["expiresAt", "purchasedAt"] as const) {
      if (item[key] !== undefined && (typeof item[key] !== "string" || !isValidIsoDate(item[key]))) {
        throw new Error(`${label}的${key}必须是有效的 YYYY-MM-DD 日期。`);
      }
    }
    return {
      name: item.name.trim(),
      ...(typeof item.id === "string" ? { id: item.id } : {}),
      ...(typeof item.amount === "string" ? { amount: item.amount } : {}),
      ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
      ...(typeof item.category === "string" ? { category: item.category as IngredientItem["category"] } : {}),
      ...(typeof item.storage === "string" ? { storage: item.storage as IngredientItem["storage"] } : {}),
      ...(typeof item.status === "string" ? { status: item.status as IngredientItem["status"] } : {}),
      ...(typeof item.expiresAt === "string" ? { expiresAt: item.expiresAt } : {}),
      ...(typeof item.purchasedAt === "string" ? { purchasedAt: item.purchasedAt } : {}),
      ...(typeof item.note === "string" ? { note: item.note } : {}),
    };
  });
}

export function parseInventoryItem(
  payload: Record<string, unknown>,
  requireName: true,
): IngredientItem;
export function parseInventoryItem(
  payload: Record<string, unknown>,
  requireName: false,
): Partial<Pick<IngredientItem, "name" | "amount" | "expiresAt" | "status">> & { storage?: IngredientItem["storage"] | "" };
export function parseInventoryItem(
  payload: Record<string, unknown>,
  requireName: boolean,
): IngredientItem | (Partial<Pick<IngredientItem, "name" | "amount" | "expiresAt" | "status">> & { storage?: IngredientItem["storage"] | "" }) {
  const allowed = new Set(["name", "amount", "storage", "expiresAt", "status", "updatedAt", "operationId"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("食材修改包含不支持的字段。");
  const result: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 100) throw new Error("食材名称必填，最多 100 个字符。");
    result.name = payload.name.trim();
  } else if (requireName) {
    throw new Error("食材名称必填。");
  }
  if (payload.amount !== undefined) {
    if (typeof payload.amount !== "string" || payload.amount.length > 200) throw new Error("数量应为不超过 200 个字符的文字。");
    result.amount = payload.amount.trim();
  }
  if (payload.storage !== undefined) {
    if (typeof payload.storage !== "string" || !["", "fridge", "freezer", "pantry", "room_temp"].includes(payload.storage)) {
      throw new Error("存放位置无效。");
    }
    result.storage = payload.storage;
  }
  if (payload.expiresAt !== undefined) {
    if (typeof payload.expiresAt !== "string" || (payload.expiresAt !== "" && !isValidIsoDate(payload.expiresAt))) {
      throw new Error("到期日必须是有效的 YYYY-MM-DD 日期，或留空。");
    }
    result.expiresAt = payload.expiresAt;
  }
  if (payload.status !== undefined) {
    const statuses = ["available", "planned", "used", "expired", "discarded"];
    if (typeof payload.status !== "string" || !statuses.includes(payload.status)) throw new Error("食材状态无效。");
    result.status = payload.status;
  }
  return result;
}

export async function readJson(request: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON body");
  return value as Record<string, unknown>;
}

