import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { evaluateEligibility, matchRecipes, type MatchRecipeResult } from "../recipes/recipeMatcher.js";
import { generateCookingPlanTool } from "../tools/generateCookingPlan.js";
import { generateMealPlanTool } from "../tools/generateMealPlan.js";
import { searchRecipesTool } from "../tools/searchRecipes.js";
import { isConfigured as isFatSecretConfigured } from "../agent/fatsecret-api.js";
import * as recipeCatalog from "../recipes/recipeCatalog.js";
import {
  DIET_AGENT_CORE_PROMPT,
  buildUserMemoryPrompt,
  buildUserRecipesPrompt,
  buildCurrentUserIdPrompt,
} from "../agent/systemPrompt.js";
import {
  classifyModelError,
  isWriteTool,
  repairToolArguments,
  resolveModelCandidates,
  shouldFallbackModel,
  wrapToolsForUser,
  ToolExecutionError,
} from "../agent/modelAdapter.js";
import {
  BUILTIN_SKILLS,
  listEnabledSkills,
  getSkillMetaBySlug,
  loadSkillContent,
  buildSkillIndexPrompt,
} from "../skills/index.js";
import type { IngredientItem, KitchenProfile, UserProfile } from "../types/diet.js";
import {
  cleanupExpiredRequestLogs,
  extractRequestMetrics,
  installRequestLogger,
  sanitizeForLog,
} from "../utils/requestLogger.js";

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

// --- Original business logic tests ---

function testRecipeBookSeeded() {
  const recipes = store.getRecipeBook();
  assert.ok(recipes.length >= 15, `expected at least 15 recipes, got ${recipes.length}`);
  const sample = recipes[0];
  assert.ok(Array.isArray(sample.mealTypes), "recipe.mealTypes should exist");
  assert.ok(Array.isArray(sample.modes), "recipe.modes should exist");
  assert.ok(Array.isArray(sample.suitableGoals), "recipe.suitableGoals should exist");
  assert.ok(Array.isArray(sample.appliances), "recipe.appliances should exist");
}

function testRecipeCatalogIncludesUserRecipesAndCorrections() {
  const userId = freshUser("catalog");
  store.clearUserData(userId);
  store.addUserRecipe({
    userId,
    name: "我的鹰嘴豆紫甘蓝锅",
    ingredients: ["鹰嘴豆", "紫甘蓝"],
    steps: ["煮熟"],
    estimatedCalories: 300,
    tags: ["一锅出", "低能量"],
  });
  store.addCalorieCorrection({
    userId,
    recipeName: "我的鹰嘴豆紫甘蓝锅",
    correctedCalories: 260,
  });

  const recipe = recipeCatalog.listForUser(userId).find((item) => item.name === "我的鹰嘴豆紫甘蓝锅");
  assert.ok(recipe, "catalog should include user recipes");
  assert.equal(recipe.estimatedCalories, 260, "catalog should apply calorie corrections");
  assert.ok(recipe.modes.includes("one_pot"), "catalog should infer structured modes from tags");
  assert.equal(recipeCatalog.getEffectiveCalories(userId, recipe.name, 300), 260);
}

async function testSearchRecipesUsesUnifiedCatalog() {
  const userId = freshUser("catalog_search");
  store.clearUserData(userId);
  baseKitchen(userId);
  store.addUserRecipe({
    userId,
    name: "我的鹰嘴豆紫甘蓝锅",
    ingredients: ["鹰嘴豆", "紫甘蓝"],
    steps: ["煮熟"],
    tags: ["一锅出"],
  });

  const result = await searchRecipesTool.execute(
    "test-catalog-search",
    { userId, query: "我的鹰嘴豆紫甘蓝锅", ingredients: ["鹰嘴豆", "紫甘蓝"] },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );
  const details = result.details as { matches: MatchRecipeResult[] };
  assert.ok(details.matches.some((match) => match.recipe.name === "我的鹰嘴豆紫甘蓝锅"));
}

function testUserRecipeParticipatesInRanking() {
  const userId = freshUser("catalog_rank");
  store.clearUserData(userId);
  const kitchen = baseKitchen(userId);
  store.addUserRecipe({
    userId,
    name: "我的鹰嘴豆紫甘蓝锅",
    ingredients: ["鹰嘴豆", "紫甘蓝"],
    steps: ["煮熟"],
    tags: ["一锅出", "低能量"],
    activeMinutes: 8,
  });
  store.addCookingFeedback({
    userId,
    recipeName: "我的鹰嘴豆紫甘蓝锅",
    rating: 5,
    wouldCookAgain: true,
  });

  const results = matchRecipes({
    recipes: recipeCatalog.listForUser(userId),
    availableIngredients: [{ name: "鹰嘴豆" }, { name: "紫甘蓝" }],
    shoppingList: [],
    kitchenProfile: kitchen,
    feedback: store.getCookingFeedback(userId),
    energyLevel: "low",
  });
  assert.equal(results[0]?.recipe.name, "我的鹰嘴豆紫甘蓝锅");
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

function testAvoidFoodIsExcluded() {
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
  assert.equal(fishRecipe, undefined, "fish recipes must be excluded for users avoiding fish");
}

function testNoOvenExcludesOvenRecipes() {
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
  assert.equal(ovenRecipe, undefined, "oven recipes must be excluded when the user has no oven");
}

function testMatcherExplainsEligibilityAndScore() {
  const userId = freshUser("matcher_explain");
  const kitchen = baseKitchen(userId, { hasOven: false, cookware: ["炒锅"] });
  const ovenRecipe = store.getRecipeBook().find((recipe) => recipe.modes.includes("oven"));
  assert.ok(ovenRecipe);
  const eligibility = evaluateEligibility(ovenRecipe, kitchen);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.rejectedReasons.some((reason) => reason.includes("烤箱")));

  const result = matchRecipes({
    recipes: store.getRecipeBook(),
    availableIngredients: [{ name: "番茄" }, { name: "鸡蛋" }],
    shoppingList: [],
    kitchenProfile: baseKitchen(userId),
    feedback: [],
  })[0];
  assert.ok(result);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.rejectedReasons, []);
  assert.equal(
    Object.values(result.scoreBreakdown).reduce((sum, points) => sum + points, 0),
    result.score
  );
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

async function testGenerateCookingPlanDoesNotPersistTransientIngredients() {
  const userId = freshUser("plan_readonly");
  store.clearUserData(userId);

  await generateCookingPlanTool.execute(
    "test-readonly-plan",
    { userId, availableIngredients: ["鸡腿"], shoppingList: ["土豆"] },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );

  const inventory = store.getIngredientInventory(userId);
  assert.deepEqual(inventory.availableIngredients, [], "planning must not persist transient available ingredients");
  assert.deepEqual(inventory.shoppingList, [], "planning must not persist transient shopping items");
}

async function testCookingPlanNeverReturnsBlockedOrOvenRecipes() {
  const allergyUser = freshUser("plan_allergy");
  store.clearUserData(allergyUser);
  baseKitchen(allergyUser);
  store.upsertUserProfile(allergyUser, { allergies: ["鱼"] });
  const allergyPlan = await generateCookingPlanTool.execute(
    "test-allergy-plan",
    { userId: allergyUser, availableIngredients: ["鱼", "西兰花"] },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );
  const allergyDetails = allergyPlan.details as { selectedRecipes: Array<{ name: string }> };
  assert.ok(allergyDetails.selectedRecipes.every((recipe) => !recipe.name.includes("鱼")));

  const noOvenUser = freshUser("plan_no_oven");
  store.clearUserData(noOvenUser);
  baseKitchen(noOvenUser, { hasOven: false, cookware: ["炒锅", "汤锅"] });
  const noOvenPlan = await generateCookingPlanTool.execute(
    "test-no-oven-plan",
    { userId: noOvenUser, availableIngredients: ["鸡腿", "土豆"] },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );
  const noOvenDetails = noOvenPlan.details as { selectedRecipes: Array<{ modes: string[] }> };
  assert.ok(noOvenDetails.selectedRecipes.every((recipe) => !recipe.modes.includes("oven")));
}

async function testMealPlanFiltersBlockedFoods() {
  const userId = freshUser("meal_plan_avoid");
  store.clearUserData(userId);
  store.upsertUserProfile(userId, { goal: "fat_loss", allergies: ["鱼"] });

  const result = await generateMealPlanTool.execute(
    "test-safe-meal-plan",
    { userId, days: 7 },
    undefined,
    undefined,
    EMPTY_EXTENSION_CONTEXT
  );
  const first = result.content[0];
  const text = first && first.type === "text" ? first.text : "";
  assert.ok(!text.includes("清蒸鱼"), "meal plans must filter templates containing blocked foods");
}

function testTodaySummaryReportsCalorieCoverage() {
  const userId = freshUser("summary_coverage");
  store.clearUserData(userId);
  store.addMealLog({
    userId,
    mealType: "breakfast",
    foods: [
      { name: "鸡蛋", amount: "1个", estimatedCalories: 80 },
      { name: "豆浆", amount: "1杯" },
    ],
  });

  const summary = store.getTodaySummary(userId);
  assert.equal(summary.estimatedTotalCalories, 80);
  assert.equal(summary.foodsWithCalories.length, 1);
  assert.equal(summary.foodsWithoutCalories.length, 1);
  assert.equal(summary.coverageRatio, 0.5);
  assert.ok(summary.summaryText.includes("已知部分约 80 kcal"));
  assert.ok(summary.summaryText.includes("不能据此判断是否超量"));
  assert.ok(!summary.summaryText.includes("约 0 kcal"));
}

function testFatSecretRequiresEnvironmentCredentials() {
  const previousId = process.env.FATSECRET_CLIENT_ID;
  const previousSecret = process.env.FATSECRET_CLIENT_SECRET;
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;

  try {
    assert.equal(isFatSecretConfigured(), false, "FatSecret must be disabled without environment credentials");
  } finally {
    if (previousId === undefined) delete process.env.FATSECRET_CLIENT_ID;
    else process.env.FATSECRET_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.FATSECRET_CLIENT_SECRET;
    else process.env.FATSECRET_CLIENT_SECRET = previousSecret;
  }
}

function testRequestLoggerRedactsSensitiveValues() {
  const sanitized = sanitizeForLog({
    authorization: "Bearer secret-token",
    medicalNotes: ["肾病"],
    nested: { allergies: ["花生"] },
    message: "健康备注：长期用药\nAuthorization: Bearer abc123",
  }) as any;
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.medicalNotes, "[REDACTED]");
  assert.equal(sanitized.nested.allergies, "[REDACTED]");
  assert.ok(!JSON.stringify(sanitized).includes("长期用药"));
  assert.ok(!JSON.stringify(sanitized).includes("abc123"));
}

function testRequestLoggerCleansExpiredFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diet-agent-logs-"));
  const oldFile = path.join(root, "old.json");
  const currentFile = path.join(root, "current.json");
  fs.writeFileSync(oldFile, "{}");
  fs.writeFileSync(currentFile, "{}");
  const now = Date.now();
  fs.utimesSync(oldFile, new Date(now - 10 * 24 * 60 * 60 * 1000), new Date(now - 10 * 24 * 60 * 60 * 1000));

  try {
    assert.equal(cleanupExpiredRequestLogs(root, 7, now), 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(currentFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRequestLoggerIsDisabledByDefault() {
  const previous = process.env.ENABLE_REQUEST_LOGS;
  delete process.env.ENABLE_REQUEST_LOGS;
  try {
    assert.equal(installRequestLogger(), false);
  } finally {
    if (previous === undefined) delete process.env.ENABLE_REQUEST_LOGS;
    else process.env.ENABLE_REQUEST_LOGS = previous;
  }
}

function testRequestLoggerExtractsProviderMetrics() {
  const metrics = extractRequestMetrics(125, JSON.stringify({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_cache_hit_tokens: 750,
    },
  }));
  assert.equal(metrics.latencyMs, 125);
  assert.equal(metrics.promptTokens, 1000);
  assert.equal(metrics.completionTokens, 200);
  assert.equal(metrics.totalTokens, 1200);
  assert.equal(metrics.cacheReadTokens, 750);
}

async function testWriteToolsAreIdempotentAndNotRetried() {
  let calls = 0;
  const wrapped = wrapToolsForUser("retry_user", [{
    name: "log_meal",
    async execute() {
      calls += 1;
      throw new Error("timeout after write");
    },
  } as any]);

  await assert.rejects(() => wrapped[0].execute("same-call", {}, undefined, undefined, EMPTY_EXTENSION_CONTEXT));
  await assert.rejects(() => wrapped[0].execute("same-call", {}, undefined, undefined, EMPTY_EXTENSION_CONTEXT));
  assert.equal(calls, 1, "a write tool call must execute at most once for the same toolCallId");
}

async function testReadToolsCanRetry() {
  let calls = 0;
  const wrapped = wrapToolsForUser("retry_user", [{
    name: "get_user_profile",
    async execute() {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return { content: [{ type: "text", text: "ok" }] };
    },
  } as any]);

  await wrapped[0].execute("read-call", {}, undefined, undefined, EMPTY_EXTENSION_CONTEXT);
  assert.equal(calls, 2, "a retryable read tool should retry once after a transient failure");
}

// --- Core prompt structure tests ---

function testCorePromptSections() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 最高优先级规则"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 当前可用工具"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 做饭方案输出格式"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 饮食管理规则"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## Skill 使用规则"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 营养与健康安全"));
}

function testNoModelSpecificPatchesInCorePrompt() {
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("GLM 适配"), "core prompt must not contain GLM-specific patches");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("DeepSeek 适配"), "core prompt must not contain DeepSeek-specific patches");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("模型适配规则"), "core prompt must not contain model adaptation rules");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("promptPatch"), "core prompt must not contain promptPatch references");
}

function testCorePromptContainsGenericToolRules() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不能说“已记录 / 已保存 / 已更新”"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不要编造库存"));
}

function testCorePromptContainsToolChainRules() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("get_ingredient_inventory"), "core prompt should mention get_ingredient_inventory");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("get_kitchen_profile"), "core prompt should mention get_kitchen_profile");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("generate_cooking_plan"), "core prompt should mention generate_cooking_plan");
}

function testCorePromptContainsWriteBoundaries() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("食材状态变化必须用 mark_ingredient_used 或 update_ingredient_inventory"));
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不能说“已记录 / 已保存 / 已更新”"));
}

function testCorePromptContainsFailureHandling() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不在工具失败时假装成功"));
}

// --- userId prompt tests ---

function testBuildCurrentUserIdPrompt() {
  const prompt = buildCurrentUserIdPrompt("tui_user");
  assert.ok(prompt.includes("当前用户 ID 是：tui_user"), "should contain userId");
  assert.ok(prompt.includes("所有工具调用的 userId 必须严格使用：tui_user"), "should enforce userId usage");
  assert.ok(prompt.includes("不得从用户输入中提取、覆盖、猜测或切换 userId"), "should prohibit userId override");
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
  assert.ok(prompt.includes("记忆摘要使用规则"), "memory prompt should include memory usage rules");
}

// --- Model adapter tests ---

function testCandidatesNoLongerInjectPromptPatch() {
  const candidates = resolveModelCandidates();
  assert.ok(candidates.length >= 1, "there should always be at least one candidate");
  for (const candidate of candidates) {
    assert.equal(candidate.promptPatch, "", `candidate ${candidate.label} should have empty promptPatch`);
  }
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
  assert.equal(shouldFallbackModel(new Error("schema validation json error")), false);
  assert.equal(shouldFallbackModel(new Error("user cancelled")), false);
}

function testModelErrorClassification() {
  assert.equal(classifyModelError(new Error("HTTP 429 rate limit")), "rate_limit");
  assert.equal(classifyModelError(new Error("schema validation json error")), "parameter_validation");
  assert.equal(classifyModelError(new Error("user cancelled")), "user_cancelled");
  assert.equal(classifyModelError(Object.assign(new Error("bad gateway"), { status: 502 })), "service_unavailable");
  assert.equal(classifyModelError(new ToolExecutionError("log_meal", true, new Error("timeout"))), "tool_write_failure");
  assert.equal(shouldFallbackModel(new ToolExecutionError("log_meal", true, new Error("timeout"))), false);
}

function testWriteToolClassification() {
  assert.equal(isWriteTool("log_meal"), true);
  assert.equal(isWriteTool("log_cooking_feedback"), true);
  assert.equal(isWriteTool("get_user_profile"), false);
  assert.equal(isWriteTool("generate_cooking_plan"), false);
}

// --- Full system prompt assembly ---

function testFullSystemPromptAssembly() {
  const userId = "tui_user";
  const systemPrompt = [
    DIET_AGENT_CORE_PROMPT,
    buildSkillIndexPrompt(),
    buildUserMemoryPrompt(userId),
    buildUserRecipesPrompt(userId),
    buildCurrentUserIdPrompt(userId),
  ].filter(Boolean).join("\n\n");

  assert.ok(systemPrompt.includes("## 最高优先级规则"), "full prompt should include core prompt");
  assert.ok(systemPrompt.includes("## Skill 使用规则"), "full prompt should include skill rules in core prompt");
  assert.ok(systemPrompt.includes("## 可用 Skill 索引"), "full prompt should include skill index");
  assert.ok(systemPrompt.includes("## 当前用户记忆摘要"), "full prompt should include memory prompt");
  assert.ok(systemPrompt.includes("当前用户 ID 是：tui_user"), "full prompt should include userId prompt");
  assert.ok(systemPrompt.includes("所有工具调用的 userId 必须严格使用：tui_user"), "full prompt must enforce userId");

  assert.ok(!systemPrompt.includes("GLM 适配"), "full prompt must not contain GLM patches");
  assert.ok(!systemPrompt.includes("DeepSeek 适配"), "full prompt must not contain DeepSeek patches");
  assert.ok(!systemPrompt.includes("模型适配规则"), "full prompt must not contain model adaptation rules");
  assert.ok(!systemPrompt.includes("candidate.promptPatch"), "full prompt must not reference promptPatch");
}

// --- Skill system tests ---

function testBuiltinSkillsRegistered() {
  assert.ok(BUILTIN_SKILLS.length >= 4, `expected at least 4 builtin skills, got ${BUILTIN_SKILLS.length}`);
  const slugs = BUILTIN_SKILLS.map((s) => s.slug);
  assert.ok(slugs.includes("low-energy-dinner"), "should include low-energy-dinner skill");
  assert.ok(slugs.includes("inventory-first-cooking"), "should include inventory-first-cooking skill");
  assert.ok(slugs.includes("cooking-feedback-learning"), "should include cooking-feedback-learning skill");
  assert.ok(slugs.includes("calorie-calibration"), "should include calorie-calibration skill");
}

function testSkillMetaFields() {
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(skill.slug, `skill should have slug`);
    assert.ok(skill.name, `skill ${skill.slug} should have name`);
    assert.ok(skill.description, `skill ${skill.slug} should have description`);
    assert.ok(skill.triggers.length > 0, `skill ${skill.slug} should have triggers`);
    assert.ok(skill.category, `skill ${skill.slug} should have category`);
    assert.ok(skill.relativePath, `skill ${skill.slug} should have relativePath`);
    assert.equal(skill.enabled, true, `skill ${skill.slug} should be enabled`);
  }
}

function testSkillRegistryHelpers() {
  const enabled = listEnabledSkills();
  assert.ok(enabled.length >= 4, `expected at least 4 enabled skills, got ${enabled.length}`);

  const found = getSkillMetaBySlug("low-energy-dinner");
  assert.ok(found, "should find low-energy-dinner by slug");
  assert.equal(found!.slug, "low-energy-dinner");

  const disabled = getSkillMetaBySlug("non-existent");
  assert.equal(disabled, undefined, "should return undefined for unknown slug");
}

function testSkillIndexPromptFormat() {
  const index = buildSkillIndexPrompt();
  assert.ok(index.includes("## 可用 Skill 索引"), "index should have header");
  assert.ok(index.includes("slug: low-energy-dinner"), "index should list low-energy-dinner");
  assert.ok(index.includes("slug: inventory-first-cooking"), "index should list inventory-first-cooking");
  assert.ok(index.includes("category:"), "index should include category");
  assert.ok(index.includes("triggers:"), "index should include trigger words");
  assert.ok(index.includes("get_skill"), "index should mention get_skill tool");
}

function testSkillIndexNotFullContent() {
  const index = buildSkillIndexPrompt();
  assert.ok(!index.includes("# 低能量晚饭规划 Skill"), "index should NOT include full SKILL.md heading");
  assert.ok(!index.includes("适用场景"), "index must not contain full skill content");
  assert.ok(!index.includes("工具调用流程"), "index must not contain tool chain from skills");
  assert.ok(!index.includes("禁止事项"), "index must not contain prohibition from skills");
}

async function testSkillLoaderCanLoadContent() {
  for (const skill of BUILTIN_SKILLS) {
    const result = await loadSkillContent(skill.slug);
    assert.ok(result, `should be able to load skill ${skill.slug}`);
    assert.equal(result.slug, skill.slug);
    assert.equal(result.name, skill.name);
    assert.ok(result.content.includes("# "), `skill ${skill.slug} should have markdown heading`);
  }
}

async function testSkillLoaderRejectsPathTraversal() {
  await assert.rejects(
    async () => loadSkillContent("../package.json"),
    /not found or disabled/i,
    "should reject path traversal attempts"
  );

  await assert.rejects(
    async () => loadSkillContent("unknown-skill"),
    /not found or disabled/i,
    "should reject unknown skill slug"
  );
}

function testCorePromptContainsSkillRules() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("Skill 使用规则"), "core prompt should include skill rules");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("get_skill"), "core prompt should mention get_skill tool");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不要一次加载所有 Skill"), "core prompt should limit skill loading");
  assert.ok(
    DIET_AGENT_CORE_PROMPT.includes("Skill 是可复用工作流程，不是用户长期记忆"),
    "core prompt should define skill vs memory boundary"
  );
}

async function run() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["recipe book seeded", testRecipeBookSeeded],
    ["recipe catalog includes user recipes and corrections", testRecipeCatalogIncludesUserRecipesAndCorrections],
    ["search recipes uses unified catalog", testSearchRecipesUsesUnifiedCatalog],
    ["user recipe participates in ranking", testUserRecipeParticipatesInRanking],
    ["ingredient status", testIngredientStatus],
    ["matcher available oven recipe", testMatcherPrefersAvailableOvenRecipe],
    ["avoid food excluded", testAvoidFoodIsExcluded],
    ["no oven excluded", testNoOvenExcludesOvenRecipes],
    ["matcher explains eligibility and score", testMatcherExplainsEligibilityAndScore],
    ["low energy mode", testLowEnergyMode],
    ["generate plan no input", testGenerateCookingPlanNoInput],
    ["generate plan does not persist transient ingredients", testGenerateCookingPlanDoesNotPersistTransientIngredients],
    ["cooking plan never returns blocked or oven recipes", testCookingPlanNeverReturnsBlockedOrOvenRecipes],
    ["meal plan filters blocked foods", testMealPlanFiltersBlockedFoods],
    ["today summary reports calorie coverage", testTodaySummaryReportsCalorieCoverage],
    ["FatSecret requires environment credentials", testFatSecretRequiresEnvironmentCredentials],
    ["request logger redacts sensitive values", testRequestLoggerRedactsSensitiveValues],
    ["request logger cleans expired files", testRequestLoggerCleansExpiredFiles],
    ["request logger is disabled by default", testRequestLoggerIsDisabledByDefault],
    ["request logger extracts provider metrics", testRequestLoggerExtractsProviderMetrics],
    ["core prompt sections", testCorePromptSections],
    ["no model-specific patches in core prompt", testNoModelSpecificPatchesInCorePrompt],
    ["core prompt contains generic tool rules", testCorePromptContainsGenericToolRules],
    ["core prompt contains toolchain rules", testCorePromptContainsToolChainRules],
    ["core prompt contains write boundaries", testCorePromptContainsWriteBoundaries],
    ["core prompt contains failure handling", testCorePromptContainsFailureHandling],
    ["build current userId prompt", testBuildCurrentUserIdPrompt],
    ["user memory prompt", testUserMemoryPromptIncludesCurrentUserId],
    ["candidates no longer inject promptPatch", testCandidatesNoLongerInjectPromptPatch],
    ["tool argument repair", testToolArgumentRepair],
    ["model fallback policy", testModelFallbackPolicy],
    ["model error classification", testModelErrorClassification],
    ["write tool classification", testWriteToolClassification],
    ["write tools are idempotent and not retried", testWriteToolsAreIdempotentAndNotRetried],
    ["read tools can retry", testReadToolsCanRetry],
    ["full system prompt assembly", testFullSystemPromptAssembly],
    ["builtin skills registered", testBuiltinSkillsRegistered],
    ["skill meta fields", testSkillMetaFields],
    ["skill registry helpers", testSkillRegistryHelpers],
    ["skill index prompt format", testSkillIndexPromptFormat],
    ["skill index not full content", testSkillIndexNotFullContent],
    ["skill loader can load content", testSkillLoaderCanLoadContent],
    ["skill loader rejects path traversal", testSkillLoaderRejectsPathTraversal],
    ["core prompt contains skill rules", testCorePromptContainsSkillRules],
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
