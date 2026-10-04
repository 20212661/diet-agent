import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRecipeSeed } from "../src/recipes/recipeSchema.js";

const path = join(process.cwd(), "src", "recipes", "recipeSeed.json");
const value = JSON.parse(readFileSync(path, "utf8"));
const errors = validateRecipeSeed(value);
if (errors.length > 0) {
  console.error(`Recipe seed validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Recipe seed validation passed: ${value.length} recipes.`);
}
