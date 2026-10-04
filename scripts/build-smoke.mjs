import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const seedPath = join(root, "dist", "recipes", "recipeSeed.json");
await access(seedPath);

const recipeModule = await import(pathToFileURL(join(root, "dist", "recipes", "recipeBook.js")));
assert.ok(recipeModule.recipeBook.length >= 60, "compiled recipe seed should be available");
assert.ok(
  recipeModule.recipeBook.every((recipe) => Array.isArray(recipe.ingredientIds) && Array.isArray(recipe.allergenTags)),
  "compiled recipes should contain normalized ingredient and allergen metadata"
);

const nutritionModule = await import(pathToFileURL(join(root, "dist", "nutrition", "nutritionCatalog.js")));
assert.ok(nutritionModule.nutritionCatalog.length >= 7_000, "compiled USDA SR Legacy catalog should be available");
assert.deepEqual(nutritionModule.validateNutritionCatalog(), [], "compiled nutrition catalog should be valid");
assert.equal(
  nutritionModule.estimateCatalogNutrition("苹果（生，带皮）", 100)?.calories,
  52,
  "compiled nutrition catalog should calculate a sourced gram-based estimate"
);

const doctorModule = await import(pathToFileURL(join(root, "dist", "agent", "configDoctor.js")));
const doctorResult = await doctorModule.checkModelConfiguration(
  {
    MODEL_PROVIDER: "deepseek",
    MODEL_ID: "deepseek-v4-flash",
    DEEPSEEK_API_KEY: "smoke-test-placeholder",
  },
  async () => new Response(JSON.stringify({ data: [{ id: "deepseek-flash" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
);
assert.equal(doctorResult.ok, true, "compiled doctor should validate canonical model aliases");
assert.equal(doctorResult.model, "deepseek-flash");

process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import(pathToFileURL(join(root, "dist", "store", "index.js")));
assert.equal(store.getRecipeBook().length, recipeModule.recipeBook.length);

console.log(`Build smoke passed: ${recipeModule.recipeBook.length} recipes, ${nutritionModule.nutritionCatalog.length} nutrition records, and doctor loaded from dist`);
