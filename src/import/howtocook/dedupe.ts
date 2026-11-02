/**
 * P3 去重：菜名规范化判重 + 食材 ID Jaccard 疑似重复。
 * 种子菜谱优先（69 道手工整理）；导入同名菜不覆盖、作为变体保留；
 * Jaccard ≥ 0.7 列疑似交人工裁决；ID = htc_ + 来源路径 sha1 前 8 位（幂等）。
 */
import { createHash } from "node:crypto";
import { normalizeIngredientId } from "../../recipes/ingredientTaxonomy.js";
import type { RecipeBookItem } from "../../recipes/recipeBook.js";
import type { HtcRawRecipe } from "./types.js";

/** 菜名规范化：剥"的做法/家常/简易/版"等装饰词后比较。 */
export function normalizeRecipeName(name: string): string {
  return name
    .replace(/（[^）]*）/g, "")
    .replace(/的做法$/, "")
    .replace(/(家常|简易|懒人|快手|快手版|改良版|家庭版|简单版)/g, "")
    .trim();
}

export function htcRecipeId(sourcePath: string): string {
  const digest = createHash("sha1").update(sourcePath, "utf8").digest("hex").slice(0, 8);
  return `htc_${digest}`;
}

export interface DedupeOutcome {
  /** 与种子或已收导入菜同名（规范化后） */
  nameDuplicateOf: string | undefined;
  /** Jaccard ≥ 0.7 的疑似重复（种子与已收导入菜里的菜名列表） */
  suspectedDuplicates: string[];
  jaccardTop: { name: string; score: number } | undefined;
}

function ingredientIdSet(ingredients: readonly string[]): Set<string> {
  return new Set(ingredients.map(normalizeIngredientId));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function dedupeCheck(
  recipe: HtcRawRecipe,
  existingRecipes: readonly Pick<RecipeBookItem, "name" | "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">[],
): DedupeOutcome {
  const targetName = normalizeRecipeName(recipe.name);
  const targetIds = ingredientIdSet([...recipe.requiredItems, ...recipe.optionalItems]);
  const suspected: string[] = [];
  let top: { name: string; score: number } | undefined;
  let nameDuplicate: string | undefined;
  for (const existing of existingRecipes) {
    if (normalizeRecipeName(existing.name) === targetName) nameDuplicate = existing.name;
    const existingIds = ingredientIdSet([
      ...existing.ingredients,
      ...(existing.optionalIngredients ?? []),
      ...(existing.vegetables ?? []),
      ...(existing.staples ?? []),
      ...(existing.primaryProtein ? [existing.primaryProtein] : []),
    ]);
    const score = jaccard(targetIds, existingIds);
    if (score > (top?.score ?? 0)) top = { name: existing.name, score };
    if (score >= 0.7) suspected.push(existing.name);
  }
  return { nameDuplicateOf: nameDuplicate, suspectedDuplicates: suspected, jaccardTop: top };
}
