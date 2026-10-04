import { describe, expect, it } from "vitest";
import {
  estimateCatalogNutrition,
  findNutritionCatalogEntry,
  nutritionCatalog,
  validateNutritionCatalog,
} from "../nutrition/nutritionCatalog.js";
import { formatNutritionCalories, isTraceableNutrition } from "../nutrition/nutritionEstimate.js";

describe("verified nutrition catalog", () => {
  it("has a broad set of unique, traceable SR Legacy records", () => {
    expect(validateNutritionCatalog()).toEqual([]);
    expect(nutritionCatalog.length).toBeGreaterThanOrEqual(7_000);
    expect(new Set(nutritionCatalog.map((entry) => entry.fdcId)).size).toBe(nutritionCatalog.length);
  });

  it("converts only explicit grams and keeps provenance with the estimate", () => {
    const result = estimateCatalogNutrition("苹果（生，带皮）", 150);
    expect(result).toMatchObject({
      status: "verified", calories: 78, amount: 150, unit: "g", grams: 150,
      sourceRecordId: "171688", sourceVersion: "FDC SR Legacy 2018-04",
    });
    expect(isTraceableNutrition(result)).toBe(true);
    expect(formatNutritionCalories(result)).toBe("78 kcal");
  });

  it("does not fuzzy-match composite foods or infer household units", () => {
    expect(findNutritionCatalogEntry("炒西兰花")).toBeUndefined();
    expect(findNutritionCatalogEntry("白米饭一碗")).toBeUndefined();
    expect(estimateCatalogNutrition("苹果（生，带皮）", Number.NaN)).toBeUndefined();
    expect(estimateCatalogNutrition("苹果（生，带皮）", 0)).toBeUndefined();
  });
});
