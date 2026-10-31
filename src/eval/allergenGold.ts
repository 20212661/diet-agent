/**
 * 人工盲标（allergenGold.json）与系统过敏原标签的比对。
 *
 * 模板只含菜名与完整食材清单（不含系统判定，保证标注独立）；标注者
 * 把确定的过敏原填进 allergens、拿不准的放进 unsure，机器只读这两个
 * 字段并忽略 `_` 开头的键（如 `_说明`）。
 *
 * 比对口径：
 * - 漏标（misses）：人工标了、系统没标——安全风险，测试直接失败，必须修分类表；
 * - 多标（extras）：系统标了、人工没标也不在 unsure——会造成误拦，逐条人工判断，只报告不失败；
 * - unsure：人工拿不准的，单独统计，不计入任何一侧。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AllergenId } from "../types/diet.js";

export interface AllergenGoldEntry {
  name: string;
  ingredients: string[];
  allergens: AllergenId[];
  unsure: AllergenId[];
}

export interface AllergenGoldFile {
  [recipeId: string]: AllergenGoldEntry;
}

export interface GoldComparison {
  recipeId: string;
  name: string;
  misses: AllergenId[];
  extras: AllergenId[];
  unsure: AllergenId[];
}

export function loadAllergenGold(): { entries: AllergenGoldFile; labeledCount: number } {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "src", "eval", "allergenGold.json"), "utf8")) as Record<string, unknown>;
  const entries: AllergenGoldFile = {};
  let labeledCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    const entry = value as Partial<AllergenGoldEntry>;
    const allergens = (entry.allergens ?? []) as AllergenId[];
    const unsure = (entry.unsure ?? []) as AllergenId[];
    if (allergens.length + unsure.length > 0) labeledCount += 1;
    entries[key] = {
      name: String(entry.name ?? key),
      ingredients: (entry.ingredients ?? []) as string[],
      allergens,
      unsure,
    };
  }
  return { entries, labeledCount };
}

export function compareAllergenGold(
  gold: AllergenId[],
  unsure: AllergenId[],
  systemTags: readonly AllergenId[],
): { misses: AllergenId[]; extras: AllergenId[]; reportedUnsure: AllergenId[] } {
  const goldSet = new Set(gold);
  const unsureSet = new Set(unsure);
  const systemSet = new Set(systemTags);
  const misses = [...goldSet].filter((id) => !systemSet.has(id)).sort();
  const extras = [...systemSet].filter((id) => !goldSet.has(id) && !unsureSet.has(id)).sort();
  const reportedUnsure = [...unsureSet].sort();
  return { misses, extras, reportedUnsure };
}
