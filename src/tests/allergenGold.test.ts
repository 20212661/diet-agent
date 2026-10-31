import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllergenId } from "../recipes/ingredientTaxonomy.js";
import type { AllergenId } from "../types/diet.js";
import {
  compareAllergenGold,
  loadAllergenGold,
} from "../eval/allergenGold.js";

const seed = JSON.parse(readFileSync(join(process.cwd(), "src", "recipes", "recipeSeed.json"), "utf8")) as Array<{
  id: string;
  name: string;
  allergenTags: AllergenId[];
}>;

describe("compareAllergenGold 纯函数", () => {
  it("漏标=人工有系统无；多标=系统有人工无且不在 unsure", () => {
    const result = compareAllergenGold(["wheat", "soy"], ["milk"], ["wheat", "peanut", "milk"]);
    expect(result.misses).toEqual(["soy"]);
    expect(result.extras).toEqual(["peanut"]);
    // milk 在 unsure 里：不算多标，也不算漏标，单独报告
    expect(result.reportedUnsure).toEqual(["milk"]);
  });

  it("完全一致时三桶皆空", () => {
    const result = compareAllergenGold(["egg"], [], ["egg"]);
    expect(result).toEqual({ misses: [], extras: [], reportedUnsure: [] });
  });
});

describe("人工盲标 vs 系统过敏原标签", () => {
  const { entries, labeledCount } = loadAllergenGold();

  it.skipIf(labeledCount === 0)("漏标为 0（有安全风险必须修分类表），多标仅报告", () => {
    const invalidIds: string[] = [];
    for (const [recipeId, entry] of Object.entries(entries)) {
      for (const id of [...entry.allergens, ...entry.unsure]) {
        if (!isAllergenId(id)) invalidIds.push(`${recipeId}: ${id}`);
      }
    }
    expect(invalidIds, `非法过敏原 ID（可用 ID 见 allergenGold.json 的 _说明）：${invalidIds.join("、")}`).toEqual([]);

    const misses: string[] = [];
    const extras: string[] = [];
    const unsure: string[] = [];
    for (const [recipeId, entry] of Object.entries(entries)) {
      if (entry.allergens.length + entry.unsure.length === 0) continue;
      const recipe = seed.find((item) => item.id === recipeId);
      expect(recipe, `allergenGold 中的 ${recipeId}（${entry.name}）不在菜谱库`).toBeTruthy();
      const result = compareAllergenGold(entry.allergens, entry.unsure, recipe!.allergenTags);
      for (const id of result.misses) misses.push(`${entry.name}(${recipeId}): ${id}`);
      for (const id of result.extras) extras.push(`${entry.name}(${recipeId}): ${id}`);
      for (const id of result.reportedUnsure) unsure.push(`${entry.name}(${recipeId}): ${id}`);
    }
    if (extras.length > 0) console.log(`[多标·仅报告，逐条判断是否误拦] ${extras.join("；")}`);
    if (unsure.length > 0) console.log(`[unsure·人工拿不准，单独统计] ${unsure.join("；")}`);
    expect(misses, `漏标（人工标了、系统没标，安全风险必须修）：${misses.join("；")}`).toEqual([]);
  });

  it.skipIf(labeledCount > 0)("模板未标注时跳过比对（等待人工盲标）", () => {
    expect(labeledCount).toBe(0);
  });
});
