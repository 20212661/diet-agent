import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { matchRecipes } from "../recipes/recipeMatcher.js";
import { generateCookingPlanTool } from "../tools/generateCookingPlan.js";
import { buildLayeredSystemPrompt, buildUserMemoryPrompt } from "../agent/systemPrompt.js";
import { repairToolArguments, resolveModelCandidates, shouldFallbackModel } from "../agent/modelAdapter.js";
import type { IngredientItem, KitchenProfile, UserProfile } from "../types/diet.js";

const EMPTY_EXTENSION_CONTEXT = {} as ExtensionContext;

function freshUser(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseKitchen(userId: string, patch: Partial<KitchenProfile> = {}) {
  return store.upsertKitchenProfile(userId, {
    burners: 2,
    hasOven: true,
    cookware: ["炒锅", "汤锅", "烤盘", "保鲜袋"],
    maxActiveMinutes: 20,
    maxTotalMinutes: 35,
    tastePreferences: [],
    cookingPreferences: ["快手", "少洗碗", "少油烟", "烤箱优先"],
    ...patch,
  });
}

function testRecipeBookSeeded() {
  const recipes = store.getRecipeBook();
  assert.ok(recipes.length >= 15, `expected at least 15 recipes, got ${recipes.length}`);
  const sample = recipes[0];
  assert.ok(Array.isArray(sample.mealTypes), "recipe.mealTypes should exist");
  assert.ok(Array.isArray(sample.modes), "recipe.modes should exist");
  assert.ok(Array.isArray(sample.suitableGoals), "recipe.suitableGoals should exist");
  assert.ok(Array.isArray(sample.appliances), "recipe.appliances should exist");
}

function testIngredientStatus() {
  const userId = freshUser("ingredient_status");
  store.clearUserData(userId);
  store.upsertIngredientInventory(userId, {
    availableIngredients: [{ name: "鸡腿", amount: "4个", storage: "fridge", status: "available" }],
    replaceAvailable: true,
  });
  const updated = store.updateIngredientStatus(userId, "鸡腿", "used", "晚饭用完");
  assert.equal(updated?.status, "used");
  const inventory = store.getIngredientInventory(userId);
  assert.equal(inventory.availableIngredients.find((item) => item.name === "鸡腿")?.status, "used");
}

function testMatcherPrefersAvailableOvenRecipe() {
  const userId = freshUser("matcher_available");
  store.clearUserData(userId);
  const recipes = store.getRecipeBook();
  const kitchen = baseKitchen(userId);
  const results = matchRecipes({
    recipes,
    availableIngredients: [
      { name: "鸡腿", status: "available" },
      { name: "土豆", status: "available" },
      { name: "西兰花", status: "available" },
    ],
    shoppingList: [],
    kitchenProfile: kitchen,
    feedback: [],
  });
  assert.equal(results[0]?.recipe.name, "烤鸡腿土豆");
  assert.ok(results[0]?.reasons.some((reason) => reason.includes("鸡腿") || reason.includes("土豆")));
}

function testAvoidFoodIsPenalized() {
  const userId = freshUser("matcher_avoid");
  store.clearUserData(userId);
  const recipes = store.getRecipeBook();
  const kitchen = baseKitchen(userId);
  const userProfile: UserProfile = {
    userId,
    avoidFoods: ["鱼"],
    allergies: [],
    preferences: [],
    medicalNotes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const results = matchRecipes({
    recipes,
    availableIngredients: [{ name: "鱼" }, { name: "西兰花" }],
    shoppingList: [],
    kitchenProfile: kitchen,
    userProfile,
    feedback: [],
  });
  const fishRecipe = results.find((result) => result.recipe.name.includes("鱼"));
  assert.ok(fishRecipe, "expected fish recipe in results");
  assert.ok(fishRecipe.score < -900, `expected fish recipe to be strongly penalized, got ${fishRecipe.score}`);
}

function testNoOvenPenalizesOvenRecipes() {
  const userId = freshUser("matcher_no_oven");
  store.clearUserData(userId);
  const recipes = store.getRecipeBook();
  const kitchen = baseKitchen(userId, { hasOven: false, cookware: ["炒锅", "汤锅"] });
  const results = matchRecipes({
    recipes,
    availableIngredients: [{ name: "鸡腿" }, { name: "土豆" }],
    shoppingList: [],
    kitchenProfile: kitchen,
    feedback: [],
  });
  const ovenRecipe = results.find((result) => result.recipe.modes.includes("oven"));
  assert.ok(ovenRecipe, "expected oven recipe in results");
  assert.ok(ovenRecipe.score < -900, `expected oven recipe to be strongly penalized, got ${ovenRecipe.score}`);
}

function testLowEnergyMode() {
  const userId = freshUser("matcher_low_energy");
  store.clearUserData(userId);
  const results = matchRecipes({
    recipes: store.getRecipeBook(),
    availableIngredients: [{ name: "鸡蛋" }, { name: "番茄" }, { name: "面" }],
    shoppingList: [],
    kitchenProfile: baseKitchen(userId),
    feedback: [],
    energyLevel: "low",
  });
  assert.ok(results[0], "expected at least one match");
  assert.ok(
    results[0].recipe.difficulty <= 2 || results[0].recipe.modes.includes("low_energy"),
    `expected low-energy friendly recipe, got ${results[0].recipe.name}`
  );
}

async function testGenerateCookingPlanNoInput() {
  const userId = freshUser("plan_empty");
  store.clearUserData(userId);
  const result = await generateCookingPlanTool.execute(
    "test-empty-plan",
    { userId, energyLevel: "low" },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );
  const first = result.content[0];
  const text = first && first.type === "text" ? first.text : "";
  assert.ok(text.includes("推荐理由"), "plan should include recommendation reasons");
  assert.ok(text.includes("晚饭方案"), "plan should include dinner plan");
}

function testLayeredPromptSections() {
  const prompt = buildLayeredSystemPrompt();
  assert.ok(prompt.includes("## 最高优先级规则"), "prompt should include base identity rules");
  assert.ok(prompt.includes("## 当前可用工具"), "prompt should include tool usage rules");
  assert.ok(prompt.includes("## 做饭方案输出格式"), "prompt should include cooking output rules");
  assert.ok(prompt.includes("## 饮食管理规则"), "prompt should include diet rules");
  assert.ok(prompt.includes("## 营养与健康安全"), "prompt should include safety rules");
}

function testUserMemoryPromptIncludesCurrentUserId() {
  const userId = freshUser("prompt_memory");
  store.clearUserData(userId);
  store.upsertKitchenProfile(userId, {
    burners: 2,
    hasOven: true,
    cookware: ["炒锅", "汤锅", "烤盘"],
    maxActiveMinutes: 20,
    maxTotalMinutes: 35,
    tastePreferences: ["清淡"],
    cookingPreferences: ["少洗碗"],
  });

  const prompt = buildUserMemoryPrompt(userId);
  assert.ok(prompt.includes(`userId：${userId}`), "memory prompt should include exact userId");
  assert.ok(prompt.includes("烤箱：有"), "memory prompt should include kitchen profile");
  assert.ok(prompt.includes("少洗碗"), "memory prompt should include cooking preferences");
}

function testToolArgumentRepair() {
  const repaired = repairToolArguments(
    "generate_cooking_plan",
    '{"userId":"wrong","availableIngredients":"鸡腿，土豆","timeLimitMinutes":"20","energyLevel":"很累"}',
    "real_user"
  );

  assert.equal(repaired.userId, "real_user");
  assert.deepEqual(repaired.availableIngredients, ["鸡腿", "土豆"]);
  assert.equal(repaired.timeLimitMinutes, 20);
  assert.equal(repaired.energyLevel, "low");
}

function testModelFallbackPolicy() {
  assert.ok(resolveModelCandidates().length >= 1, "there should always be at least the SDK default candidate");
  assert.equal(shouldFallbackModel(new Error("HTTP 429 rate limit")), true);
  assert.equal(shouldFallbackModel(new Error("schema validation json error")), true);
  assert.equal(shouldFallbackModel(new Error("user cancelled")), false);
}

async function run() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["recipe book seeded", testRecipeBookSeeded],
    ["ingredient status", testIngredientStatus],
    ["matcher available oven recipe", testMatcherPrefersAvailableOvenRecipe],
    ["avoid food penalty", testAvoidFoodIsPenalized],
    ["no oven penalty", testNoOvenPenalizesOvenRecipes],
    ["low energy mode", testLowEnergyMode],
    ["generate plan no input", testGenerateCookingPlanNoInput],
    ["layered prompt sections", testLayeredPromptSections],
    ["user memory prompt", testUserMemoryPromptIncludesCurrentUserId],
    ["tool argument repair", testToolArgumentRepair],
    ["model fallback policy", testModelFallbackPolicy],
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS ${name}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
