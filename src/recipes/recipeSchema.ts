import { Type } from "typebox";
import { Errors } from "typebox/value";
import type { RecipeBookItem } from "./recipeBook.js";
import {
  deriveRecipeIngredientMetadata,
  normalizeIngredientId,
  UNRESOLVED_RECIPE_INGREDIENTS,
  validateIngredientTaxonomy,
} from "./ingredientTaxonomy.js";

const Nutrition = Type.Object({
  status: Type.Union([Type.Literal("verified"), Type.Literal("range"), Type.Literal("unavailable")]),
  calories: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
  lowerCalories: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
  upperCalories: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
  foodName: Type.String({ minLength: 1 }),
  amount: Type.Number({ exclusiveMinimum: 0 }),
  unit: Type.String({ minLength: 1 }),
  grams: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  cookingMethod: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
  sourceRecordId: Type.String({ minLength: 1 }),
  sourceVersion: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

const MealType = Type.Union([
  Type.Literal("breakfast"), Type.Literal("lunch"), Type.Literal("dinner"), Type.Literal("snack"),
]);
const Mode = Type.Union([
  Type.Literal("quick"), Type.Literal("oven"), Type.Literal("stovetop"),
  Type.Literal("one_pot"), Type.Literal("low_energy"), Type.Literal("prep"), Type.Literal("freezer_reuse"),
]);
const Appliance = Type.Union([
  Type.Literal("oven"), Type.Literal("stove"), Type.Literal("microwave"), Type.Literal("rice_cooker"),
]);
const Allergen = Type.Union([
  Type.Literal("peanut"), Type.Literal("tree_nut"), Type.Literal("milk"), Type.Literal("egg"),
  Type.Literal("soy"), Type.Literal("wheat"), Type.Literal("gluten"), Type.Literal("fish"),
  Type.Literal("shellfish"), Type.Literal("sesame"),
]);

export const RecipeSeedItemSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: "^[a-z0-9_]+$" }),
  name: Type.String({ minLength: 1 }),
  mode: Mode,
  mealTypes: Type.Array(MealType, { minItems: 1, uniqueItems: true }),
  modes: Type.Array(Mode, { minItems: 1, uniqueItems: true }),
  suitableGoals: Type.Array(Type.String()),
  ingredients: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
  optionalIngredients: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  ingredientIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
  allergenTags: Type.Array(Allergen, { uniqueItems: true }),
  primaryProtein: Type.Optional(Type.String()),
  vegetables: Type.Array(Type.String()),
  staples: Type.Array(Type.String()),
  cookware: Type.Array(Type.String(), { uniqueItems: true }),
  appliances: Type.Array(Appliance, { uniqueItems: true }),
  activeMinutes: Type.Integer({ minimum: 0, maximum: 120 }),
  totalMinutes: Type.Integer({ minimum: 1, maximum: 240 }),
  difficulty: Type.Integer({ minimum: 1, maximum: 5 }),
  dishCount: Type.Integer({ minimum: 0, maximum: 5 }),
  tasteTags: Type.Array(Type.String()),
  preferenceTags: Type.Array(Type.String()),
  seasonTags: Type.Optional(Type.Array(Type.String())),
  steps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  timeline: Type.Optional(Type.Array(Type.String())),
  lowEnergySwap: Type.Optional(Type.String()),
  weekendPrep: Type.Optional(Type.String()),
  freezerReuse: Type.Optional(Type.String()),
  nutrition: Type.Optional(Nutrition),
  proteinLevel: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
}, { additionalProperties: false });

const RecipeSeedSchema = Type.Array(RecipeSeedItemSchema, { minItems: 1 });

const applianceStepTerms: Record<string, readonly string[]> = {
  oven: ["烤箱"],
  microwave: ["微波"],
  rice_cooker: ["电饭煲"],
  stove: ["锅", "煎", "炒", "煮", "炖", "焯"],
};

export function validateRecipeSeed(value: unknown): string[] {
  const errors = [
    ...validateIngredientTaxonomy(),
    ...[...Errors(RecipeSeedSchema, value)].map((error) => `${error.instancePath || "/"}: ${error.message}`),
  ];
  if (!Array.isArray(value)) return errors;
  const seen = new Set<string>();
  const seedIngredients = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const recipe = raw as Partial<RecipeBookItem>;
    const label = recipe.id || "<missing-id>";
    if (recipe.nutrition) {
      if (recipe.nutrition.status === "verified" && recipe.nutrition.calories === undefined) {
        errors.push(`${label}: verified nutrition requires calories`);
      }
      if (recipe.nutrition.status === "range" &&
          (recipe.nutrition.lowerCalories === undefined || recipe.nutrition.upperCalories === undefined || recipe.nutrition.upperCalories < recipe.nutrition.lowerCalories)) {
        errors.push(`${label}: range nutrition requires valid lower and upper calories`);
      }
    }
    if (recipe.id && seen.has(recipe.id)) errors.push(`${label}: duplicate recipe id`);
    if (recipe.id) seen.add(recipe.id);
    if (typeof recipe.activeMinutes === "number" && typeof recipe.totalMinutes === "number" && recipe.totalMinutes < recipe.activeMinutes) {
      errors.push(`${label}: totalMinutes must be >= activeMinutes`);
    }
    if (Array.isArray(recipe.appliances) && Array.isArray(recipe.steps)) {
      const steps = recipe.steps.join(" ");
      for (const appliance of recipe.appliances) {
        if (!(applianceStepTerms[appliance] ?? []).some((term) => steps.includes(term))) {
          errors.push(`${label}: appliance ${appliance} is not reflected in steps`);
        }
      }
    }
    if (Array.isArray(recipe.ingredients) && Array.isArray(recipe.optionalIngredients)) {
      const ingredients = [
        ...recipe.ingredients,
        ...recipe.optionalIngredients,
        ...(recipe.primaryProtein ? [recipe.primaryProtein] : []),
        ...(recipe.vegetables ?? []),
        ...(recipe.staples ?? []),
      ];
      for (const ingredient of ingredients) seedIngredients.add(ingredient);
      const expected = deriveRecipeIngredientMetadata(ingredients);
      if (JSON.stringify(recipe.ingredientIds) !== JSON.stringify(expected.ingredientIds)) {
        errors.push(`${label}: ingredientIds do not match normalized ingredients`);
      }
      if (JSON.stringify(recipe.allergenTags) !== JSON.stringify(expected.allergenTags)) {
        errors.push(`${label}: allergenTags are incomplete or stale`);
      }
    }
  }
  for (const ingredient of seedIngredients) {
    if (normalizeIngredientId(ingredient).startsWith("ingredient:") && !UNRESOLVED_RECIPE_INGREDIENTS[ingredient]) {
      errors.push(`Unmapped seed ingredient needs allergen review: ${ingredient}`);
    }
  }
  for (const unresolved of Object.keys(UNRESOLVED_RECIPE_INGREDIENTS)) {
    if (!seedIngredients.has(unresolved)) errors.push(`Unused unresolved ingredient review: ${unresolved}`);
  }
  return errors;
}
