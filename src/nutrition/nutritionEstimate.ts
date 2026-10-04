import type { NutritionEstimate } from "../types/diet.js";
import { estimateCatalogNutrition } from "./nutritionCatalog.js";

/** Only complete, sourced values may participate in user-visible totals. */
export function isTraceableNutrition(value: NutritionEstimate | undefined): value is NutritionEstimate {
  if (!value || !value.foodName.trim() || !value.cookingMethod.trim() || !value.source.trim() ||
      !value.sourceRecordId.trim() || !value.sourceVersion.trim() || !value.unit.trim() ||
      !Number.isFinite(value.amount) || value.amount <= 0) return false;
  if (value.grams !== undefined && (!Number.isFinite(value.grams) || value.grams <= 0)) return false;
  if (value.status === "verified") {
    if (!Number.isFinite(value.calories) || (value.calories ?? -1) < 0) return false;
    // These records are supplied by an LLM tool call, so provenance strings alone
    // are not evidence. Accept verified values only when the local catalog can
    // reproduce the exact food state, gram amount, source identity, and calories.
    const canonical = estimateCatalogNutrition(value.foodName, value.grams ?? Number.NaN, value.sourceRecordId);
    return Boolean(canonical &&
      value.amount === canonical.amount &&
      value.unit === canonical.unit &&
      value.grams === canonical.grams &&
      value.cookingMethod === canonical.cookingMethod &&
      value.source === canonical.source &&
      value.sourceRecordId === canonical.sourceRecordId &&
      value.sourceVersion === canonical.sourceVersion &&
      value.calories === canonical.calories);
  }
  if (value.status === "range") {
    return Number.isFinite(value.lowerCalories) && Number.isFinite(value.upperCalories) &&
      (value.lowerCalories ?? -1) >= 0 && (value.upperCalories ?? -1) >= (value.lowerCalories ?? Infinity);
  }
  return value.status === "unavailable";
}

export function formatNutritionCalories(value: NutritionEstimate | undefined): string | undefined {
  if (!isTraceableNutrition(value)) return undefined;
  if (value.status === "verified") return `${Math.round(value.calories!)} kcal`;
  if (value.status === "range") return `${Math.round(value.lowerCalories!)}–${Math.round(value.upperCalories!)} kcal`;
  return "无法估算";
}

export function getVerifiedCalories(value: NutritionEstimate | undefined): number | undefined {
  if (!isTraceableNutrition(value) || value.status !== "verified") return undefined;
  return value.calories;
}
