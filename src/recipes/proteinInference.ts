/**
 * 主要蛋白的确定性解析（修复 B）：primaryProtein 字段优先；为空时从食材清单
 * 顺序取第一个蛋白类食材（肉/禽/鱼/蛋/豆腐等，名单见下）。推断值单独标记来源
 * （field=导入抽取字段 / inferred=规则推断）；推断不出的菜（素菜/配料复杂）
 * 返回 undefined，由调用方统计。
 *
 * 名单口径（2026-11-07）：畜肉及制品（含排骨/内脏）、禽及部位、水产、蛋、
 * 豆腐类（tofu/tofu_skin）。排除调料与仿味品（鸡精/高汤/肉味香精/各类酱）、
 * 佐餐配料（肉松/虾皮）、饮品（奶/豆浆）；整豆与豆芽按配菜处理不算主蛋白。
 */
import { normalizeIngredientId } from "./ingredientTaxonomy.js";

const PRIMARY_PROTEIN_IDS = new Set([
  // 畜肉及制品
  "pork", "pork_lean", "pork_ribs", "pork_trotter", "pork_skin", "processed_pork", "cured_pork",
  "luncheon_meat", "chinese_sausage", "ham", "htc_ham", "blood_sausage", "meat_unspecified",
  "beef", "lamb_brisket", "lamb_rib", "lamb_ribs", "lamb_or_offal", "rabbit_meat", "bullfrog_meat",
  // 禽及部位
  "chicken", "whole_chicken", "chicken_breast", "chicken_thigh", "chicken_wing", "chicken_liver", "chicken_feet", "duck",
  // 水产
  "fish", "salmon", "shrimp_meat", "crab", "oyster", "squid", "river_snail", "snail_meat",
  // 蛋
  "egg",
  // 豆腐类
  "tofu", "tofu_skin",
]);

export interface PrimaryProtein {
  value: string;
  source: "field" | "inferred";
}

/**
 * 解析菜谱的主要蛋白：
 * 1. 字段值（导入抽取）——但字段 ID 必须能对应到食材清单里的某一项；
 * 2. 否则从食材清单顺序推断第一个蛋白类食材（如排骨炖土豆的字段"猪肉"
 *    不在食材里，推断出"排骨"）。
 */
export function resolvePrimaryProtein(recipe: Pick<RecipeLike, "primaryProtein" | "ingredients">): PrimaryProtein | undefined {
  const inferred = recipe.ingredients.find((ingredient) => PRIMARY_PROTEIN_IDS.has(normalizeIngredientId(ingredient)));
  if (recipe.primaryProtein && recipe.primaryProtein.trim()) {
    // 字段 ID 在食材清单里 → 用字段值（可追溯）
    const fieldId = normalizeIngredientId(recipe.primaryProtein);
    if (inferred && normalizeIngredientId(inferred) === fieldId) {
      return { value: recipe.primaryProtein, source: "field" };
    }
    // 字段 ID 不在食材里（排骨炖土豆："猪肉"≠"排骨"）→ 用推断值
  }
  return inferred ? { value: inferred, source: "inferred" } : undefined;
}

interface RecipeLike {
  primaryProtein?: string;
  ingredients: readonly string[];
}

/** 主要蛋白是否落在缺失清单里（按分类 ID 判等，规避词形差异）。 */
export function isPrimaryProteinMissing(protein: PrimaryProtein, missing: readonly string[]): boolean {
  const proteinId = normalizeIngredientId(protein.value);
  return missing.some((item) => normalizeIngredientId(item) === proteinId);
}
