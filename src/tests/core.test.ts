import { describe, it, expect } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KitchenProfile, UserProfile } from "../types/diet.js";

// 测试隔离：store 模块在导入时即初始化数据库，先把路径指向内存库，避免污染生产数据。
// 因此这些（会传递依赖到 store 的）导入必须用顶层 await 动态完成，确保 env 设置先执行。
process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { matchRecipes } = await import("../recipes/recipeMatcher.js");
const { generateCookingPlanTool } = await import("../tools/generateCookingPlan.js");
const { buildLayeredSystemPrompt, buildUserMemoryPrompt } = await import("../agent/systemPrompt.js");
const {
  repairToolArguments,
  resolveModelCandidates,
  shouldFallbackModel,
} = await import("../agent/modelAdapter.js");
const { generateWeeklyPlanTool } = await import("../tools/generateWeeklyPlan.js");

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

describe("菜谱库", () => {
  it("已种子化且包含结构化字段", () => {
    const recipes = store.getRecipeBook();
    expect(recipes.length).toBeGreaterThanOrEqual(15);
    const sample = recipes[0];
    expect(Array.isArray(sample.mealTypes)).toBe(true);
    expect(Array.isArray(sample.modes)).toBe(true);
    expect(Array.isArray(sample.suitableGoals)).toBe(true);
    expect(Array.isArray(sample.appliances)).toBe(true);
  });
});

describe("食材库存状态更新", () => {
  it("精确命中并更新状态", () => {
    const userId = freshUser("ingredient_status");
    store.clearUserData(userId);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [{ name: "鸡腿", amount: "4个", storage: "fridge", status: "available" }],
      replaceAvailable: true,
    });
    const updated = store.updateIngredientStatus(userId, "鸡腿", "used", "晚饭用完");
    expect(updated?.status).toBe("used");
    const inventory = store.getIngredientInventory(userId);
    expect(inventory.availableIngredients.find((i) => i.name === "鸡腿")?.status).toBe("used");
  });

  it("歧义模糊匹配不误伤任何食材", () => {
    const userId = freshUser("ingredient_ambiguous");
    store.clearUserData(userId);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "鸡蛋", status: "available" },
        { name: "皮蛋", status: "available" },
      ],
      replaceAvailable: true,
    });
    // "蛋" 同时是 "鸡蛋" 和 "皮蛋" 的子串 —— 模糊匹配有歧义，不应改动任何食材
    const result = store.updateIngredientStatus(userId, "蛋", "used");
    expect(result).toBeNull();
    const inventory = store.getIngredientInventory(userId);
    expect(inventory.availableIngredients.find((i) => i.name === "鸡蛋")?.status).toBe("available");
    expect(inventory.availableIngredients.find((i) => i.name === "皮蛋")?.status).toBe("available");
  });

  it("精确匹配优先于子串匹配，不误伤同名食材", () => {
    const userId = freshUser("ingredient_exact");
    store.clearUserData(userId);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "鸡腿", status: "available" },
        { name: "鸡腿菇", status: "available" },
      ],
      replaceAvailable: true,
    });
    // 精确匹配 "鸡腿" 应只命中 "鸡腿"，不动 "鸡腿菇"
    const result = store.updateIngredientStatus(userId, "鸡腿", "used");
    expect(result?.name).toBe("鸡腿");
    expect(result?.status).toBe("used");
    const inventory = store.getIngredientInventory(userId);
    expect(inventory.availableIngredients.find((i) => i.name === "鸡腿")?.status).toBe("used");
    expect(inventory.availableIngredients.find((i) => i.name === "鸡腿菇")?.status).toBe("available");
  });
});

describe("菜谱匹配算法", () => {
  it("优先推荐库存已满足的烤箱菜", () => {
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
    expect(results[0]?.recipe.name).toBe("烤鸡腿土豆");
    expect(results[0]?.reasons.some((r) => r.includes("鸡腿") || r.includes("土豆"))).toBe(true);
  });

  it("忌口食材被强惩罚", () => {
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
    const fishRecipe = results.find((r) => r.recipe.ingredients.some((i) => i.includes("鱼")));
    expect(fishRecipe).toBeTruthy();
    expect(fishRecipe!.score).toBeLessThan(-900);
  });

  it("没有烤箱时烤箱菜被强惩罚", () => {
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
    const ovenRecipe = results.find((r) => r.recipe.modes.includes("oven"));
    expect(ovenRecipe).toBeTruthy();
    expect(ovenRecipe!.score).toBeLessThan(-900);
  });

  it("低能量模式下优先推荐省力菜", () => {
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
    expect(results[0]).toBeTruthy();
    expect(
      results[0].recipe.difficulty <= 2 || results[0].recipe.modes.includes("low_energy")
    ).toBe(true);
  });
});

describe("做饭与周计划工具", () => {
  it("无输入时仍能生成做饭计划", async () => {
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
    expect(text).toContain("推荐理由");
    expect(text).toContain("晚饭方案");
  });

  it("生成一周菜单并持久化", async () => {
    const userId = freshUser("weekly_plan");
    store.clearUserData(userId);
    baseKitchen(userId);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "鸡腿", status: "available" },
        { name: "鸡蛋", status: "available" },
        { name: "番茄", status: "available" },
      ],
      replaceAvailable: true,
    });

    const result = await generateWeeklyPlanTool.execute(
      "test-weekly-plan",
      { userId },
      undefined,
      undefined,
      EMPTY_EXTENSION_CONTEXT
    );
    const firstBlock = result.content[0];
    const text = firstBlock && "text" in firstBlock ? firstBlock.text : "";
    expect(text).toContain("一周菜单");
    const details = result.details as { weekStartDate: string; days: { mainRecipe: { name: string }; date: string; dayOfWeek: number }[] };
    const days = details.days;
    expect(days.length).toBeGreaterThanOrEqual(5);
    expect(days[0].mainRecipe.name).toBeTruthy();
    expect(days[0].date).toBeTruthy();
    expect(days[0].dayOfWeek).toBeGreaterThanOrEqual(1);
    expect(days[0].dayOfWeek).toBeLessThanOrEqual(7);

    const saved = store.getWeeklyPlan(userId, details.weekStartDate);
    expect(saved).toBeTruthy();
    expect(saved!.days.length).toBe(days.length);
  });

  it("周计划清除后归档不再返回", () => {
    const userId = freshUser("weekly_clear");
    store.clearUserData(userId);
    store.upsertWeeklyPlan(userId, "2026-06-08", [
      {
        dayOfWeek: 1,
        date: "2026-06-08",
        mainRecipe: { id: "test", name: "测试菜", activeMinutes: 10, totalMinutes: 20 },
        staplesSuggestion: "米饭",
        reasons: [],
        missingIngredients: [],
        completed: false,
      },
    ]);
    const before = store.getWeeklyPlan(userId, "2026-06-08");
    expect(before).toBeTruthy();

    const cleared = store.clearWeeklyPlan(userId, "2026-06-08");
    expect(cleared).toBe(true);

    const after = store.getWeeklyPlan(userId, "2026-06-08");
    expect(after).toBeUndefined();
  });
});

describe("系统提示词", () => {
  it("分层提示词包含所有必要章节", () => {
    const prompt = buildLayeredSystemPrompt();
    expect(prompt).toContain("## 最高优先级规则");
    expect(prompt).toContain("## 当前可用工具");
    expect(prompt).toContain("## 做饭方案输出格式");
    expect(prompt).toContain("## 饮食管理规则");
    expect(prompt).toContain("## 营养与健康安全");
  });

  it("用户记忆提示词注入当前 userId 与画像", () => {
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
    expect(prompt).toContain(`userId：${userId}`);
    expect(prompt).toContain("烤箱：有");
    expect(prompt).toContain("少洗碗");
  });
});

describe("模型适配与工具参数修复", () => {
  it("修复 LLM 输出的 userId / 数组 / 数字 / 枚举", () => {
    const repaired = repairToolArguments(
      "generate_cooking_plan",
      '{"userId":"wrong","availableIngredients":"鸡腿，土豆","timeLimitMinutes":"20","energyLevel":"很累"}',
      "real_user"
    );

    expect(repaired.userId).toBe("real_user");
    expect(repaired.availableIngredients).toEqual(["鸡腿", "土豆"]);
    expect(repaired.timeLimitMinutes).toBe(20);
    expect(repaired.energyLevel).toBe("low");
  });

  it("模型降级策略按错误类型判定", () => {
    expect(resolveModelCandidates().length).toBeGreaterThanOrEqual(1);
    expect(shouldFallbackModel(new Error("HTTP 429 rate limit"))).toBe(true);
    expect(shouldFallbackModel(new Error("schema validation json error"))).toBe(true);
    expect(shouldFallbackModel(new Error("user cancelled"))).toBe(false);
  });
});
