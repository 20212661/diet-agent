import { createRequire } from "node:module";
import type { NutritionEstimate } from "../types/diet.js";

export interface NutritionCatalogEntry {
  id: string;
  nameZh?: string;
  aliases: string[];
  fdcDescription: string;
  fdcId: string;
  dataType: "sr_legacy_food";
  sourceVersion: string;
  caloriesPer100g: number;
  cookingMethod: string;
  referenceGrams: 100;
  foodCategory: string;
  calculationAllowed: boolean;
}

const require = createRequire(import.meta.url);
export const nutritionCatalog = require("./nutritionCatalog.json") as NutritionCatalogEntry[];
export const NUTRITION_CATALOG_SOURCE = "USDA FoodData Central";
const CALCULABLE_CATEGORIES = new Set([
  "Dairy and Egg Products", "Spices and Herbs", "Fats and Oils", "Poultry Products",
  "Fruits and Fruit Juices", "Pork Products", "Vegetables and Vegetable Products",
  "Nut and Seed Products", "Beef Products", "Finfish and Shellfish Products",
  "Legumes and Legume Products", "Lamb, Veal, and Game Products", "Cereal Grains and Pasta",
]);
const COMPOSITE_DESCRIPTION = /\b(?:restaurant|babyfood|baby food|fast foods?|mixed|mixture|blend|soup|sauce|dressing|salad|sandwich|casserole|entree|pie|cake|cookie|biscuit|waffle|pancake|pastry|snack|candy|pizza|burger|pudding|custard|curry)\b|,\s*and\s/i;

function isCalculationAllowed(entry: NutritionCatalogEntry): boolean {
  return typeof entry.foodCategory === "string" &&
    typeof entry.fdcDescription === "string" &&
    CALCULABLE_CATEGORIES.has(entry.foodCategory) &&
    !COMPOSITE_DESCRIPTION.test(entry.fdcDescription);
}

const byName = new Map<string, Set<NutritionCatalogEntry>>();
for (const entry of nutritionCatalog) {
  for (const name of [entry.nameZh, entry.fdcDescription, ...entry.aliases]) {
    if (!name?.trim()) continue;
    const key = normalizeFoodName(name);
    const matches = byName.get(key) ?? new Set<NutritionCatalogEntry>();
    matches.add(entry);
    byName.set(key, matches);
  }
}

export function normalizeFoodName(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

/** Exact name/alias lookup only. Do not match composite dishes or infer preparation state. */
export function findNutritionCatalogEntry(name: string, fdcId?: string): NutritionCatalogEntry | undefined {
  if (!name.trim()) return undefined;
  const matches = byName.get(normalizeFoodName(name));
  if (fdcId) return [...(matches ?? [])].find((entry) => entry.fdcId === fdcId);
  return matches?.size === 1 ? matches.values().next().value : undefined;
}

/** Find a small, ranked candidate set; ambiguous names must be resolved explicitly. */
export function searchNutritionCatalog(query: string, limit = 12): NutritionCatalogEntry[] {
  const normalizedQuery = normalizeFoodName(query);
  if (!normalizedQuery) return [];
  const ranked = nutritionCatalog.flatMap((entry) => {
    if (!isCalculationAllowed(entry)) return [];
    const terms = [entry.nameZh, entry.fdcDescription, ...entry.aliases]
      .filter((term): term is string => Boolean(term?.trim()))
      .map(normalizeFoodName);
    const matchingTerms = terms.filter((term) => term.includes(normalizedQuery));
    if (!matchingTerms.length) return [];
    const score = matchingTerms.some((term) => term === normalizedQuery) ? 0
      : matchingTerms.some((term) => term.startsWith(normalizedQuery)) ? 1 : 2;
    return [{ entry, score }];
  });
  return ranked
    .sort((left, right) => left.score - right.score || left.entry.fdcDescription.localeCompare(right.entry.fdcDescription))
    .slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
    .map(({ entry }) => entry);
}

/** Calculate calories only from an explicitly supplied gram weight. */
export function estimateCatalogNutrition(name: string, grams: number, fdcId?: string): NutritionEstimate | undefined {
  const entry = findNutritionCatalogEntry(name, fdcId);
  if (!entry || !isCalculationAllowed(entry) || !Number.isFinite(grams) || grams <= 0) return undefined;
  return {
    status: "verified",
    calories: Math.round(entry.caloriesPer100g * grams / entry.referenceGrams * 10) / 10,
    foodName: entry.nameZh ?? entry.fdcDescription,
    amount: grams,
    unit: "g",
    grams,
    cookingMethod: entry.cookingMethod,
    source: `${NUTRITION_CATALOG_SOURCE} ${entry.dataType}`,
    sourceRecordId: entry.fdcId,
    sourceVersion: entry.sourceVersion,
  };
}

export function validateNutritionCatalog(): string[] {
  const errors: string[] = [];
  if (nutritionCatalog.length < 7_000) errors.push(`Expected at least 7,000 SR Legacy records; found ${nutritionCatalog.length}`);
  const ids = new Set<string>();
  const fdcIds = new Set<string>();
  for (const entry of nutritionCatalog) {
    if (ids.has(entry.id)) errors.push(`Duplicate catalog id: ${entry.id}`);
    if (fdcIds.has(entry.fdcId)) errors.push(`Duplicate FDC id: ${entry.fdcId}`);
    ids.add(entry.id);
    fdcIds.add(entry.fdcId);
    if ((entry.nameZh !== undefined && !entry.nameZh.trim()) || !entry.fdcDescription.trim() || !entry.cookingMethod.trim()) errors.push(`Incomplete identity or preparation: ${entry.id}`);
    if (!/^\d+$/.test(entry.fdcId)) errors.push(`Invalid FDC id: ${entry.id}`);
    if (entry.dataType !== "sr_legacy_food" || entry.sourceVersion !== "FDC SR Legacy 2018-04") errors.push(`Unexpected provenance: ${entry.id}`);
    if (entry.referenceGrams !== 100 || !Number.isFinite(entry.caloriesPer100g) || entry.caloriesPer100g < 0) errors.push(`Invalid energy basis: ${entry.id}`);
    if (!entry.foodCategory.trim() || typeof entry.calculationAllowed !== "boolean") errors.push(`Missing category or calculation policy: ${entry.id}`);
    if (entry.calculationAllowed !== isCalculationAllowed(entry)) errors.push(`Incorrect single-food calculation policy: ${entry.id}`);
  }
  return errors;
}
