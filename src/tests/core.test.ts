import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { matchRecipes } from "../recipes/recipeMatcher.js";
import { generateCookingPlanTool } from "../tools/generateCookingPlan.js";
import {
  DIET_AGENT_CORE_PROMPT,
  buildUserMemoryPrompt,
  buildUserRecipesPrompt,
  buildCurrentUserIdPrompt,
} from "../agent/systemPrompt.js";
import { repairToolArguments, resolveModelCandidates, shouldFallbackModel } from "../agent/modelAdapter.js";
import {
  BUILTIN_SKILLS,
  listEnabledSkills,
  getSkillMetaBySlug,
  loadSkillContent,
  buildSkillIndexPrompt,
} from "../skills/index.js";
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

// --- Core prompt structure tests ---

function testCorePromptSections() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 1. 最高优先级规则"), "core prompt should include §1");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 2. 工具调用通用规则"), "core prompt should include §2");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 3. Skill 使用规则"), "core prompt should include §3");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 4. 工具类型"), "core prompt should include §4");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 5. 意图路由规则"), "core prompt should include §5");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 7. 完整晚饭方案工具链"), "core prompt should include §7");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 8. 做饭方案输出格式"), "core prompt should include §8");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 9. 低能量模式规则"), "core prompt should include §9");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 15. 营养与健康安全"), "core prompt should include §15");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 17. 工具失败处理"), "core prompt should include §17");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("## 18. 回复风格"), "core prompt should include §18");
}

function testNoModelSpecificPatchesInCorePrompt() {
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("GLM 适配"), "core prompt must not contain GLM-specific patches");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("DeepSeek 适配"), "core prompt must not contain DeepSeek-specific patches");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("模型适配规则"), "core prompt must not contain model adaptation rules");
  assert.ok(!DIET_AGENT_CORE_PROMPT.includes("promptPatch"), "core prompt must not contain promptPatch references");
}

function testCorePromptContainsGenericToolRules() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("工具参数必须是 JSON object"), "core prompt should require JSON object params");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("无法确定的字段应省略，不要编造"), "core prompt should require omitting uncertain fields");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("写入类工具只能基于用户明确陈述调用"), "core prompt should constrain write tools");
}

function testCorePromptContainsToolChainRules() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("get_ingredient_inventory"), "core prompt should mention get_ingredient_inventory");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("get_kitchen_profile"), "core prompt should mention get_kitchen_profile");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("generate_cooking_plan"), "core prompt should mention generate_cooking_plan");
}

function testCorePromptContainsWriteBoundaries() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("写入类工具只能基于用户明确陈述调用"), "core prompt should enforce write boundaries");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不要根据推测写入长期记忆"), "core prompt should prohibit speculative writes");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不要把建议写成事实"), "core prompt should prohibit suggestion-as-fact");
}

function testCorePromptContainsFailureHandling() {
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("工具失败处理"), "core prompt should include failure handling section");
  assert.ok(DIET_AGENT_CORE_PROMPT.includes("不要说\"已保存 / 已记录 / 已更新\""), "core prompt should prohibit fake success");
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
  assert.equal(shouldFallbackModel(new Error("schema validation json error")), true);
  assert.equal(shouldFallbackModel(new Error("user cancelled")), false);
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

  assert.ok(systemPrompt.includes("## 1. 最高优先级规则"), "full prompt should include core prompt");
  assert.ok(systemPrompt.includes("## 3. Skill 使用规则"), "full prompt should include skill rules in core prompt");
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
  assert.ok(
    DIET_AGENT_CORE_PROMPT.includes("用户不吃香菜") && DIET_AGENT_CORE_PROMPT.includes("属于用户记忆"),
    "core prompt should include Skill/Memory boundary examples"
  );
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
