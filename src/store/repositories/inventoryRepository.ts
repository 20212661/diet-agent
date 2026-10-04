import { isAvailable, isExpired, type IngredientInventory, type IngredientItem } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { generateId, nowISO, parseJsonArray, stringifyJson, todayDate } from "../shared.js";

function computeExpiresSoon(item: IngredientItem): boolean {
  if (!item.expiresAt) return false;
  const diff = (new Date(item.expiresAt).getTime() - new Date(todayDate()).getTime()) / 86_400_000;
  return diff >= 0 && diff <= 3 && isAvailable(item);
}

function ensureItemDefaults(item: IngredientItem): IngredientItem {
  return {
    ...item,
    id: item.id || generateId("ing"),
    status: item.status || "available",
    expiresSoon: computeExpiresSoon(item),
    isExpired: isExpired(item),
    isAvailable: isAvailable(item),
  };
}

function nextUpdatedAt(previous?: string): string {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

function toIngredientItems(items: string[] | IngredientItem[] | undefined, defaultStatus: IngredientItem["status"] = "available"): IngredientItem[] {
  return (items ?? []).map((item) => typeof item === "string"
    ? ensureItemDefaults({ name: item, status: defaultStatus })
    : ensureItemDefaults({ ...item, status: item.status ?? defaultStatus }));
}

function ensureShoppingDefaults(item: IngredientItem): IngredientItem {
  return ensureItemDefaults({ ...item, status: item.status ?? "planned" });
}

function mergeItems(base: IngredientItem, patch: IngredientItem): IngredientItem {
  const result: IngredientItem = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null && value !== "") {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  result.expiresSoon = computeExpiresSoon(result);
  result.isExpired = isExpired(result);
  result.isAvailable = isAvailable(result);
  return result;
}

function dedupeIngredients(items: IngredientItem[]): IngredientItem[] {
  const unique = new Map<string, IngredientItem>();
  for (const item of items) {
    const key = `${item.name}|${item.storage || "unknown"}`;
    unique.set(key, unique.has(key) ? mergeItems(unique.get(key)!, item) : item);
  }
  return [...unique.values()];
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
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  const existingAvailable = row ? parseJsonArray<IngredientItem>(row.available_ingredients_json as string).map(ensureItemDefaults) : [];
  const existingShopping = row ? parseJsonArray<IngredientItem>(row.shopping_list_json as string).map(ensureShoppingDefaults) : [];
  const availablePatch = toIngredientItems(patch.availableIngredients);
  const shoppingPatch = toIngredientItems(patch.shoppingList, "planned");
  const availableIngredients = dedupeIngredients(patch.replaceAvailable
    ? availablePatch
    : [...existingAvailable, ...availablePatch]);
  const shoppingList = dedupeIngredients(patch.replaceShoppingList
    ? shoppingPatch
    : [...existingShopping, ...shoppingPatch]);
  const updatedAt = nextUpdatedAt(row?.updated_at as string | undefined);

  db.prepare(`
    INSERT INTO ingredient_inventory (user_id, available_ingredients_json, shopping_list_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      available_ingredients_json = excluded.available_ingredients_json,
      shopping_list_json = excluded.shopping_list_json, updated_at = excluded.updated_at
  `).run(userId, stringifyJson(availableIngredients), stringifyJson(shoppingList), updatedAt);
  return { userId, availableIngredients, shoppingList, updatedAt };
}

export function replaceIngredientInventoryIfCurrent(
  userId: string,
  expectedUpdatedAt: string,
  availableIngredients: IngredientItem[],
  shoppingList: IngredientItem[],
): { status: "updated"; inventory: IngredientInventory } | { status: "conflict"; inventory: IngredientInventory } {
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare("SELECT updated_at FROM ingredient_inventory WHERE user_id = ?")
      .get(userId) as { updated_at: string } | undefined;
    if (row && row.updated_at !== expectedUpdatedAt) {
      return { status: "conflict", inventory: getIngredientInventory(userId) } as const;
    }
    const inventory = upsertIngredientInventory(userId, {
      availableIngredients,
      shoppingList,
      replaceAvailable: true,
      replaceShoppingList: true,
    });
    return { status: "updated", inventory } as const;
  })();
}

export function getIngredientInventory(userId: string): IngredientInventory {
  const row = getDatabase().prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return { userId, availableIngredients: [], shoppingList: [], updatedAt: nowISO() };
  const rawAvailable = parseJsonArray<IngredientItem>(row.available_ingredients_json as string);
  const rawShopping = parseJsonArray<IngredientItem>(row.shopping_list_json as string);
  const availableIngredients = rawAvailable.map(ensureItemDefaults);
  const shoppingList = rawShopping.map(ensureShoppingDefaults);
  let updatedAt = row.updated_at as string;
  if (rawAvailable.some((item) => !item.id) || rawShopping.some((item) => !item.id)) {
    updatedAt = nextUpdatedAt(updatedAt);
    getDatabase().prepare(`
      UPDATE ingredient_inventory SET available_ingredients_json = ?, shopping_list_json = ?, updated_at = ?
      WHERE user_id = ?
    `).run(stringifyJson(availableIngredients), stringifyJson(shoppingList), updatedAt, userId);
  }
  return {
    userId: row.user_id as string,
    availableIngredients,
    shoppingList,
    updatedAt,
  };
}

export function addIngredientInventoryItem(userId: string, input: IngredientItem): { item: IngredientItem; inventory: IngredientInventory } {
  const item = ensureItemDefaults(input);
  const inventory = upsertIngredientInventory(userId, item.status === "planned"
    ? { shoppingList: [item] }
    : { availableIngredients: [item] });
  const saved = [...inventory.availableIngredients, ...inventory.shoppingList].find((candidate) => candidate.id === item.id) ?? item;
  return { item: saved, inventory };
}

export type UpdateInventoryItemResult =
  | { status: "updated"; inventory: IngredientInventory; item: IngredientItem }
  | { status: "conflict"; inventory: IngredientInventory }
  | { status: "not_found"; inventory: IngredientInventory };

export function updateIngredientInventoryItem(
  userId: string,
  itemId: string,
  expectedUpdatedAt: string,
  patch: Partial<Pick<IngredientItem, "name" | "amount" | "expiresAt" | "status">> & { storage?: IngredientItem["storage"] | "" },
): UpdateInventoryItemResult {
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
    if (!row) return { status: "not_found", inventory: getIngredientInventory(userId) } as const;
    const currentUpdatedAt = row.updated_at as string;
    if (currentUpdatedAt !== expectedUpdatedAt) {
      return { status: "conflict", inventory: getIngredientInventory(userId) } as const;
    }
    const available = parseJsonArray<IngredientItem>(row.available_ingredients_json as string).map(ensureItemDefaults);
    const shopping = parseJsonArray<IngredientItem>(row.shopping_list_json as string).map(ensureShoppingDefaults);
    const source = available.some((item) => item.id === itemId) ? available : shopping;
    const index = source.findIndex((item) => item.id === itemId);
    if (index < 0) return { status: "not_found", inventory: getIngredientInventory(userId) } as const;

    const previous = source.splice(index, 1)[0]!;
    const updated: IngredientItem = { ...previous };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.amount !== undefined) {
      if (patch.amount.trim()) updated.amount = patch.amount.trim();
      else delete updated.amount;
    }
    if (patch.storage !== undefined) {
      if (patch.storage) updated.storage = patch.storage;
      else delete updated.storage;
    }
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt.trim()) updated.expiresAt = patch.expiresAt;
      else delete updated.expiresAt;
    }
    if (patch.status !== undefined) updated.status = patch.status;
    updated.expiresSoon = computeExpiresSoon(updated);
    updated.isExpired = isExpired(updated);
    updated.isAvailable = isAvailable(updated);

    const destination = updated.status === "planned" ? shopping : available;
    destination.push(updated);
    const nextAt = nextUpdatedAt(currentUpdatedAt);
    db.prepare(`
      UPDATE ingredient_inventory SET available_ingredients_json = ?, shopping_list_json = ?, updated_at = ?
      WHERE user_id = ?
    `).run(stringifyJson(available), stringifyJson(shopping), nextAt, userId);
    const inventory: IngredientInventory = { userId, availableIngredients: available, shoppingList: shopping, updatedAt: nextAt };
    return { status: "updated", inventory, item: updated } as const;
  })();
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

export function updateIngredientStatus(
  userId: string,
  itemName: string,
  status: IngredientItem["status"],
  note?: string
): IngredientItem | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM ingredient_inventory WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const available = parseJsonArray<IngredientItem>(row.available_ingredients_json as string);
  const shopping = parseJsonArray<IngredientItem>(row.shopping_list_json as string);
  const target = normalizeName(itemName);
  const findIn = (items: IngredientItem[]): IngredientItem | null => {
    const exact = items.filter((item) => normalizeName(item.name) === target);
    if (exact.length === 1) return exact[0]!;
    if (exact.length > 1) return null;
    const fuzzy = items.filter((item) => {
      const name = normalizeName(item.name);
      return name.includes(target) || target.includes(name);
    });
    return fuzzy.length === 1 ? fuzzy[0] : null;
  };
  const updated = findIn(available) ?? findIn(shopping);
  if (!updated) return null;
  updated.status = status;
  updated.isAvailable = isAvailable(updated);
  if (note) updated.note = note;
  const nextAt = nextUpdatedAt(row.updated_at as string);
  db.prepare(`
    UPDATE ingredient_inventory SET available_ingredients_json = ?, shopping_list_json = ?, updated_at = ?
    WHERE user_id = ?
  `).run(stringifyJson(available), stringifyJson(shopping), nextAt, userId);
  return updated;
}
