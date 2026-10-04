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
  const blockedAllergens = new Set<AllergenId>([
    ...resolveAllergenIds(avoidFoods),
    ...resolveAllergenIds(allergies),
  ]);
  const conflicts = new Set<string>();
  for (const tag of explicitAllergenTags) {
    if (blockedAllergens.has(tag)) conflicts.add(tag);
  }

  const unknownIngredients: string[] = [];
  for (const ingredient of ingredients) {
    const ingredientId = normalizeIngredientId(ingredient);
    if (ingredientId.startsWith("ingredient:")) unknownIngredients.push(ingredient);
    const ingredientAllergens = resolveAllergenIds([ingredient]);
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
  return Boolean(normalizedRestriction.length >= 2 && (
    normalizedIngredient === normalizedRestriction ||
    normalizedIngredient.includes(normalizedRestriction) ||
    normalizedRestriction.includes(normalizedIngredient)
  ));
}
