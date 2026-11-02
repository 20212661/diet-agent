import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRecipeSeed } from "../src/recipes/recipeSchema.js";

function validateFile(label: string, relativePath: string): number {
  const path = join(process.cwd(), relativePath);
  const value = JSON.parse(readFileSync(path, "utf8"));
  const recipes = Array.isArray(value) ? value : (value.recipes ?? []);
  const errors = validateRecipeSeed(recipes);
  if (errors.length > 0) {
    console.error(`${label} validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return 0;
  }
  console.log(`${label} validation passed: ${recipes.length} recipes.`);
  return recipes.length;
}

const seedCount = validateFile("Recipe seed", "src/recipes/recipeSeed.json");
const importedCount = validateFile("Imported (HowToCook)", "src/recipes/imported/howtocook.json");
if (seedCount > 0 && importedCount > 0) {
  const ids = new Set<string>();
  const all = [
    ...JSON.parse(readFileSync(join(process.cwd(), "src/recipes/recipeSeed.json"), "utf8")),
    ...JSON.parse(readFileSync(join(process.cwd(), "src/recipes/imported/howtocook.json"), "utf8")).recipes,
  ] as Array<{ id: string }>;
  for (const recipe of all) {
    if (ids.has(recipe.id)) {
      console.error(`Duplicate recipe id across seed/imported: ${recipe.id}`);
      process.exitCode = 1;
    }
    ids.add(recipe.id);
  }
}
