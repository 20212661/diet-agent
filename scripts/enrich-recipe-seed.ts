import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveRecipeIngredientMetadata } from "../src/recipes/ingredientTaxonomy.js";

const path = join(process.cwd(), "src", "recipes", "recipeSeed.json");
const recipes = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>;
for (const recipe of recipes) {
  const ingredients = [
    ...((recipe.ingredients as string[] | undefined) ?? []),
    ...((recipe.optionalIngredients as string[] | undefined) ?? []),
    ...((recipe.primaryProtein ? [recipe.primaryProtein as string] : [])),
    ...((recipe.vegetables as string[] | undefined) ?? []),
    ...((recipe.staples as string[] | undefined) ?? []),
  ];
  Object.assign(recipe, deriveRecipeIngredientMetadata(ingredients));
  if (["beef_onion_rice_bowl", "braised_pork_rice"].includes(String(recipe.id))) {
    const steps = recipe.steps as string[];
    if (!steps.some((step) => step.includes("电饭煲"))) steps.unshift("用电饭煲提前煮好米饭。");
  }
}
writeFileSync(path, `${JSON.stringify(recipes, null, 2)}\n`, "utf8");
console.log(`Enriched ${recipes.length} recipes with normalized ingredient and allergen metadata.`);
