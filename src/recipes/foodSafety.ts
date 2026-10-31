import type { AllergenId } from "../types/diet.js";
import { normalizeIngredientId, resolveAllergenIds } from "./ingredientTaxonomy.js";

export interface FoodSafetyProfile {
  avoidFoods?: readonly string[];
  allergies?: readonly string[];
}

export interface FoodSafetyAssessment {
  status: "clear" | "conflict" | "needs_verification";
  conflicts: string[];
  unknownIngredients: string[];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s_\-、，,（）()]/g, "").trim();
}

/** One deterministic gate shared by every recommendation path. */
export function assessFoodSafety(
  ingredients: readonly string[],
  profile: FoodSafetyProfile = {},
  explicitAllergenTags: readonly AllergenId[] = [],
): FoodSafetyAssessment {
  const avoidFoods = (profile.avoidFoods ?? []).filter(Boolean);
  const allergies = (profile.allergies ?? []).filter(Boolean);
  // 只有过敏才展开成过敏原类别：过敏走宽松匹配（用户写"虾"要命中虾仁、
  // "奶"要命中黄油，宁可多拦）。忌口只是口味偏好，误拦没有安全收益——
  // 旧逻辑把忌口也做类别展开，"葱"会经反向子串屏蔽全部小麦菜、"油"
  // 几乎过滤整个菜谱库；忌口只按食材名文本匹配（下方 textMatches）。
  const blockedAllergens = new Set<AllergenId>(resolveAllergenIds(allergies));
  const conflicts = new Set<string>();
  for (const tag of explicitAllergenTags) {
    if (blockedAllergens.has(tag)) conflicts.add(tag);
  }

  const unknownIngredients: string[] = [];
  for (const ingredient of ingredients) {
    const ingredientId = normalizeIngredientId(ingredient);
    if (ingredientId.startsWith("ingredient:")) unknownIngredients.push(ingredient);
    const ingredientAllergens = resolveAllergenIds([ingredient], "ingredient");
    for (const allergen of ingredientAllergens) {
      if (blockedAllergens.has(allergen)) conflicts.add(`${ingredient} (${allergen})`);
    }

    const normalizedIngredient = normalizeText(ingredient);
    for (const avoided of avoidFoods) {
      if (textMatches(normalizedIngredient, avoided)) conflicts.add(`${ingredient} (忌口: ${avoided})`);
    }
    for (const allergy of allergies) {
      if (textMatches(normalizedIngredient, allergy)) conflicts.add(`${ingredient} (过敏: ${allergy})`);
    }
  }

  if (conflicts.size > 0) {
    return { status: "conflict", conflicts: [...conflicts], unknownIngredients: [...new Set(unknownIngredients)] };
  }
  if ((avoidFoods.length > 0 || allergies.length > 0) && unknownIngredients.length > 0) {
    return { status: "needs_verification", conflicts: [], unknownIngredients: [...new Set(unknownIngredients)] };
  }
  return { status: "clear", conflicts: [], unknownIngredients: [] };
}

function textMatches(normalizedIngredient: string, restriction: string): boolean {
  const normalizedRestriction = normalizeText(restriction);
  // 忌口/过敏描述允许单字（"葱""鱼""油"）：精确相等或作为食材名子串都算命中。
  // 反向（描述包含食材名）要求描述 ≥2 字，避免空串/单字误匹配。
  if (!normalizedRestriction) return false;
  return normalizedIngredient === normalizedRestriction
    || normalizedIngredient.includes(normalizedRestriction)
    || normalizedRestriction.includes(normalizedIngredient);
}
