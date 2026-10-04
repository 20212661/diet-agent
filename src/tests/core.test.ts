import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KitchenProfile, UserProfile } from "../types/diet.js";

// 测试隔离：store 模块在导入时即初始化数据库，先把路径指向内存库，避免污染生产数据。
// 因此这些（会传递依赖到 store 的）导入必须用顶层 await 动态完成，确保 env 设置先执行。
process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { matchRecipes } = await import("../recipes/recipeMatcher.js");
const { matchRecipesDetailed } = await import("../recipes/recipeMatcher.js");
const { isAvailable, isAvailableOn } = await import("../types/diet.js");
const { generateCookingPlanTool } = await import("../tools/generateCookingPlan.js");
const { buildLayeredSystemPrompt, buildUserMemoryPrompt } = await import("../agent/systemPrompt.js");
const {
  repairToolArguments,
  classifyModelError,
  normalizeModelId,
  resolveModelRequests,
  resolveModelCandidates,
  shouldFallbackToCandidate,
  shouldFallbackModel,
  wrapToolsForUser,
} = await import("../agent/modelAdapter.js");
const { extractLastAssistantText, extractLastAssistantError } = await import("../agent/createDietAgent.js");
const { generateWeeklyPlanTool } = await import("../tools/generateWeeklyPlan.js");
const { logMealTool } = await import("../tools/logMeal.js");
const { installRequestLogger } = await import("../utils/requestLogger.js");

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

  it("按稳定 ID 区分同名但储存位置不同的食材，并检测并发修改", () => {
    const userId = freshUser("inventory_item_id");
    store.clearUserData(userId);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "番茄", amount: "2个", storage: "fridge", status: "available" },
        { name: "番茄", amount: "4个", storage: "pantry", status: "available" },
      ], replaceAvailable: true,
    });
    const before = store.getIngredientInventory(userId);
    const [fridge, pantry] = before.availableIngredients;
    expect(fridge?.id).toBeTruthy();
    expect(pantry?.id).toBeTruthy();
    expect(fridge?.id).not.toBe(pantry?.id);
    const changed = store.updateIngredientInventoryItem(userId, pantry!.id!, before.updatedAt, { amount: "3个" });
    expect(changed.status).toBe("updated");
    if (changed.status === "updated") {
      expect(changed.item.storage).toBe("pantry");
      expect(changed.item.amount).toBe("3个");
    }
    const stale = store.updateIngredientInventoryItem(userId, fridge!.id!, before.updatedAt, { status: "used" });
    expect(stale.status).toBe("conflict");
  });

  it("购物清单内容统一标记为待采购且不可用", () => {
    const userId = freshUser("shopping_inventory_state");
    store.clearUserData(userId);
    store.upsertIngredientInventory(userId, { shoppingList: ["番茄"], replaceShoppingList: true });
    const item = store.getIngredientInventory(userId).shoppingList[0]!;
    expect(item.status).toBe("planned");
    expect(item.isAvailable).toBe(false);
    expect(isAvailable(item)).toBe(false);
    expect(isAvailableOn({ status: "available", expiresAt: "2026-09-27" }, "2026-09-28")).toBe(false);
    expect(isAvailable({ status: "available", expiresAt: "invalid" })).toBe(false);
  });

  it("到期日已过的食材不再可用，也不属于快过期", () => {
    const userId = freshUser("expired_inventory");
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    store.upsertIngredientInventory(userId, {
      availableIngredients: [{ name: "牛奶", status: "available", expiresAt: yesterday }],
      replaceAvailable: true,
    });
    const item = store.getIngredientInventory(userId).availableIngredients[0]!;
    expect(item).toMatchObject({ status: "available", isExpired: true, isAvailable: false, expiresSoon: false });
    expect(isAvailable(item)).toBe(false);
  });

  it("已用库存不会作为可用食材参与菜谱匹配", () => {
    const userId = freshUser("used_not_available");
    const template = store.getRecipeBook()[0]!;
    const recipe = { ...template, id: "requires-tomato", ingredients: ["番茄"], appliances: [], cookware: [] };
    expect(isAvailable({ status: "used" })).toBe(false);
    const results = matchRecipes({
      recipes: [recipe], availableIngredients: [{ name: "番茄", status: "used" }], shoppingList: [],
      kitchenProfile: baseKitchen(userId), feedback: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.missingIngredients).toContain("番茄");
  });

  it("购物清单中的必需食材仍属于缺料，并标为已列待购", () => {
    const userId = freshUser("matcher_shopping_readiness");
    const template = store.getRecipeBook()[0]!;
    const required = template.ingredients[0]!;
    const recipe = { ...template, id: "shopping-readiness", ingredients: [required], appliances: [], cookware: [] };
    const result = matchRecipes({
      recipes: [recipe], availableIngredients: [], shoppingList: [{ name: required, status: "planned" }],
      kitchenProfile: baseKitchen(userId), feedback: [],
    })[0]!;
    expect(result.missingIngredients).toContain(required);
    expect(result.ingredientReadiness).toContainEqual({ ingredient: required, status: "already_on_list" });
  });
});

describe("菜谱匹配算法", () => {
  it("所有候选与过敏原冲突时返回结构化 no_match", () => {
    const userId = freshUser("matcher_allergy_no_match");
    const recipes = store.getRecipeBook().slice(0, 3).map((recipe) => ({
      ...recipe,
      allergenTags: ["shellfish" as const],
    }));
    const outcome = matchRecipesDetailed({
      recipes,
      availableIngredients: [],
      shoppingList: [],
      kitchenProfile: baseKitchen(userId),
      userProfile: { allergies: ["虾"] } as UserProfile,
      feedback: [],
    });
    expect(outcome.status).toBe("no_match");
    expect(outcome.matches).toEqual([]);
    expect(outcome.blockingReasons.join(" ")).toContain("过敏或忌口冲突");
    expect(outcome.adjustableConditions).toContain("放宽主动操作时间上限");
  });

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

  it("忌口/过敏食材被硬过滤", () => {
    const userId = freshUser("matcher_avoid");
    store.clearUserData(userId);
    const recipes = store.getRecipeBook();
    const kitchen = baseKitchen(userId);
    const userProfile: UserProfile = {
      userId,
      avoidFoods: ["鱼"],
      allergies: ["鸡蛋"],
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
    expect(results.some((r) => r.recipe.ingredients.some((i) => i.includes("鱼") || i.includes("鸡蛋")))).toBe(false);
  });

  it("没有烤箱时烤箱菜被硬过滤", () => {
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
    expect(results.some((r) => r.recipe.modes.includes("oven"))).toBe(false);
  });

  it("微波炉和电饭煲缺失时对应菜谱被硬过滤", () => {
    const userId = freshUser("matcher_appliances");
    store.clearUserData(userId);
    const template = store.getRecipeBook()[0];
    const microwaveRecipe = {
      ...template,
      id: "test_microwave",
      appliances: ["microwave" as const],
      cookware: [],
    };
    const riceCookerRecipe = {
      ...template,
      id: "test_rice_cooker",
      appliances: ["rice_cooker" as const],
      cookware: [],
    };

    const unavailable = matchRecipes({
      recipes: [microwaveRecipe, riceCookerRecipe],
      availableIngredients: [],
      shoppingList: [],
      kitchenProfile: baseKitchen(userId, { hasMicrowave: false, hasRiceCooker: false }),
      feedback: [],
    });
    expect(unavailable).toEqual([]);

    const available = matchRecipes({
      recipes: [microwaveRecipe, riceCookerRecipe],
      availableIngredients: [],
      shoppingList: [],
      kitchenProfile: baseKitchen(userId, { hasMicrowave: true, hasRiceCooker: true }),
      feedback: [],
    });
    expect(available.map((item) => item.recipe.id).sort()).toEqual([
      "test_microwave",
      "test_rice_cooker",
    ]);
  });

  it("缺少必需厨具时菜谱被硬过滤", () => {
    const userId = freshUser("matcher_cookware");
    store.clearUserData(userId);
    const results = matchRecipes({
      recipes: store.getRecipeBook(),
      availableIngredients: [],
      shoppingList: [],
      kitchenProfile: baseKitchen(userId, { cookware: [] }),
      feedback: [],
    });
    expect(results.every((r) => r.recipe.cookware.length === 0)).toBe(true);
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
  it("读取周计划时按最新库存重算食材备料状态", () => {
    const userId = freshUser("weekly_readiness_refresh");
    store.clearUserData(userId);
    const kitchen = store.getKitchenProfile(userId);
    const recipe = matchRecipes({
      recipes: store.getRecipeBook(), availableIngredients: [], shoppingList: [],
      kitchenProfile: kitchen, feedback: [],
    }).find((item) => item.recipe.activeMinutes <= kitchen.maxActiveMinutes
      && item.recipe.totalMinutes <= kitchen.maxTotalMinutes)!.recipe;
    const required = recipe.ingredients[0]!;
    const date = "2026-09-21";
    store.upsertIngredientInventory(userId, { shoppingList: [{ name: required, status: "planned" }], replaceShoppingList: true });
    store.upsertWeeklyPlan(userId, date, [{
      dayOfWeek: 1, date,
      mainRecipe: { id: recipe.id, name: recipe.name, activeMinutes: recipe.activeMinutes, totalMinutes: recipe.totalMinutes },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], completed: false,
    }]);
    const listed = store.getWeeklyPlan(userId, date)!.days[0]!;
    expect(listed.missingIngredients).toContain(required);
    expect(listed.ingredientReadiness?.find((item) => item.ingredient === required)?.status).toBe("already_on_list");

    store.upsertIngredientInventory(userId, {
      availableIngredients: [{ name: required, amount: "1份文字", status: "available" }],
      shoppingList: [], replaceAvailable: true, replaceShoppingList: true,
    });
    const stocked = store.getWeeklyPlan(userId, date)!.days[0]!;
    expect(stocked.missingIngredients).not.toContain(required);
    expect(stocked.ingredientReadiness?.find((item) => item.ingredient === required)).toMatchObject({
      status: "owned", quantityVerified: false,
    });
  });

  it("晚餐记录只做提示，完成计划必须显式操作且换菜清除旧状态", () => {
    const userId = freshUser("weekly_explicit_done");
    store.clearUserData(userId);
    baseKitchen(userId, { cookware: ["炒锅", "汤锅", "烤盘", "平底锅", "保鲜袋"] });
    const [firstRecipe, secondRecipe] = store.getRecipeBook();
    const weekStartDate = "2026-09-21";
    const date = weekStartDate;
    store.upsertWeeklyPlan(userId, weekStartDate, [{
      dayOfWeek: 1, date,
      mainRecipe: { id: firstRecipe!.id, name: firstRecipe!.name, activeMinutes: firstRecipe!.activeMinutes, totalMinutes: firstRecipe!.totalMinutes },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], completed: false,
    }]);
    store.addMealLog({ userId, date, mealType: "dinner", foods: [{ name: "外卖", amount: "1份" }] });
    const dinnerOnly = store.getWeeklyPlan(userId, weekStartDate)!;
    expect(dinnerOnly.days[0]).toMatchObject({ completed: false, hasDinnerLog: true });

    const marked = store.setWeeklyPlanDayCompleted(userId, weekStartDate, date, firstRecipe!.id, dinnerOnly.updatedAt, true);
    expect(marked.status).toBe("updated");
    const completed = store.getWeeklyPlan(userId, weekStartDate)!;
    expect(completed.days[0]?.completed).toBe(true);
    const replaced = store.replaceWeeklyPlanDayMainRecipe(userId, weekStartDate, date, completed.updatedAt, {
      mainRecipe: { id: secondRecipe!.id, name: secondRecipe!.name, activeMinutes: secondRecipe!.activeMinutes, totalMinutes: secondRecipe!.totalMinutes },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], ingredientReadiness: [],
    });
    expect(replaced.status).toBe("updated");
    expect(store.getWeeklyPlan(userId, weekStartDate)?.days[0]?.completed).toBe(false);
  });

  it("0 灶台且无其他设备时不推荐冷冻饺子青菜汤", async () => {
    const userId = freshUser("plan_zero_burners");
    store.clearUserData(userId);
    baseKitchen(userId, {
      burners: 0, hasOven: false, hasMicrowave: false, hasRiceCooker: false,
      cookware: [], maxActiveMinutes: 15,
    });
    const result = await generateCookingPlanTool.execute(
      "test-no-appliance-plan", { userId }, undefined, undefined, EMPTY_EXTENSION_CONTEXT,
    );
    const text = result.content[0] && result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).not.toContain("冷冻饺子青菜汤");
    expect(text).not.toContain("灶台 1：冷冻饺子青菜汤");
  });

  it("无候选时返回无可执行方案，缺少食材不会伪装为空方案", async () => {
    const userId = freshUser("plan_safety_no_match");
    store.clearUserData(userId);
    baseKitchen(userId);
    store.upsertUserProfile(userId, { allergies: ["虾"] });
    const candidate = { ...store.getRecipeBook()[0], allergenTags: ["shellfish" as const] };
    const recipeBookSpy = vi.spyOn(store, "getRecipeBook").mockReturnValue([candidate]);
    let result;
    try {
      result = await generateCookingPlanTool.execute(
        "test-safety-no-match", { userId }, undefined, undefined, EMPTY_EXTENSION_CONTEXT,
      );
    } finally {
      recipeBookSpy.mockRestore();
    }
    const text = result.content[0] && result.content[0].type === "text" ? result.content[0].text : "";
    expect(result.details).toMatchObject({ status: "no_match", selectedRecipes: [], missingIngredients: [] });
    expect(text).toContain("没有可执行方案");
    expect(text).not.toContain("需要额外购买：无需额外购买");
  });

  it("菜谱主动操作时间超过上限时不生成可执行方案", async () => {
    const userId = freshUser("plan_real_time");
    store.clearUserData(userId);
    baseKitchen(userId, { maxActiveMinutes: 15 });
    const template = store.getRecipeBook().find((recipe) => recipe.name === "白灼虾")!;
    const recipeBookSpy = vi.spyOn(store, "getRecipeBook").mockReturnValue([{ ...template, activeMinutes: 25, totalMinutes: 30 }]);
    let result;
    try {
      result = await generateCookingPlanTool.execute(
        "test-real-active-time", {
          userId, availableIngredients: ["基围虾"], timeLimitMinutes: 15,
        }, undefined, undefined, EMPTY_EXTENSION_CONTEXT,
      );
    } finally {
      recipeBookSpy.mockRestore();
    }
    const text = result.content[0] && result.content[0].type === "text" ? result.content[0].text : "";
    expect(result.details).toMatchObject({ status: "no_match", activeMinutes: 0, selectedRecipes: [] });
    expect(text).toContain("没有可执行方案");
    expect(text).not.toContain("主动操作约 15 分钟");
  });

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
      hasMicrowave: true,
      hasRiceCooker: true,
      cookware: ["炒锅", "汤锅", "烤盘"],
      maxActiveMinutes: 20,
      maxTotalMinutes: 35,
      tastePreferences: ["清淡"],
      cookingPreferences: ["少洗碗"],
    });

    const prompt = buildUserMemoryPrompt(userId);
    expect(prompt).toContain(`userId：${userId}`);
    expect(prompt).toContain("烤箱：有");
    expect(prompt).toContain("微波炉：有");
    expect(prompt).toContain("电饭煲：有");
    expect(prompt).toContain("少洗碗");
  });
});

describe("模型适配与工具参数修复", () => {
  it("从 Agent 完整消息中提取最后一条 assistant 文本", () => {
    expect(
      extractLastAssistantText([
        { role: "assistant", content: [{ type: "text", text: "旧回复" }] },
        { role: "toolResult", content: [{ type: "text", text: "工具结果" }] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "内部思考" },
          { type: "text", text: "你好" },
          { type: "text", text: "，我来帮你安排。" },
        ] },
      ])
    ).toBe("你好，我来帮你安排。");
    expect(extractLastAssistantText([])).toBe("");
  });

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

  it("修复厨房设备布尔值，覆盖微波炉和电饭煲", () => {
    const repaired = repairToolArguments(
      "update_kitchen_profile",
      {
        userId: "wrong",
        hasOven: "是",
        hasMicrowave: "有",
        hasRiceCooker: "没有",
      },
      "real_user"
    );

    expect(repaired).toMatchObject({
      userId: "real_user",
      hasOven: true,
      hasMicrowave: true,
      hasRiceCooker: false,
    });
  });

  it("模型降级策略按错误类型判定", () => {
    expect(resolveModelCandidates().length).toBeGreaterThanOrEqual(1);
    expect(shouldFallbackModel(Object.assign(new Error("limited"), { status: 429 }))).toBe(true);
    expect(shouldFallbackModel(new Error("schema validation json error"))).toBe(false);
    expect(shouldFallbackModel(Object.assign(new Error("denied"), { status: 401 }))).toBe(true);
    expect(shouldFallbackModel(new Error("user cancelled"))).toBe(false);
  });

  it("模型错误按状态和网络错误码精确分类", () => {
    expect(classifyModelError({ status: 401 }).kind).toBe("authentication");
    expect(classifyModelError({ statusCode: 503 }).kind).toBe("server");
    expect(classifyModelError(new Error("provider failed with HTTP 502")).kind).toBe("server");
    expect(classifyModelError({ code: "ECONNRESET" }).kind).toBe("network");
    expect(classifyModelError({ status: 400 }).retryable).toBe(false);
    expect(classifyModelError(new Error("tool json schema mismatch")).kind).toBe("unknown");
  });

  it("认证失败只允许切换到不同供应商", () => {
    const failed = { key: "a", provider: "deepseek", kind: "deepseek", label: "a", supportsTools: true, promptPatch: "" } as const;
    const sameProvider = { ...failed, key: "b", label: "b" };
    const otherProvider = { ...failed, key: "c", provider: "zai", kind: "glm", label: "c" } as const;
    const authError = { status: 401 };
    expect(shouldFallbackToCandidate(authError, failed, sameProvider)).toBe(false);
    expect(shouldFallbackToCandidate(authError, failed, otherProvider)).toBe(true);
  });

  it("候选模型由供应商配置驱动、显式供应商优先且每家只有一个候选", () => {
    const requests = resolveModelRequests({
      MODEL_PROVIDER: "zai",
      MODEL_ID: "glm-5.1",
      ZAI_API_KEY: "zai-key",
      DEEPSEEK_API_KEY: "deepseek-key",
      OPENAI_API_KEY: "openai-key",
    });
    expect(requests.map((item) => item.provider)).toEqual(["zai", "deepseek", "openai"]);
    expect(requests[0].modelId).toBe("glm-5.1");
    expect(new Set(requests.map((item) => item.provider)).size).toBe(requests.length);
  });

  it("DeepSeek 旧模型名归一化为当前模型名", () => {
    expect(normalizeModelId("deepseek", "deepseek-v4-flash")).toBe("deepseek-flash");
    expect(normalizeModelId("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizeModelId("openai", "gpt-4o")).toBe("gpt-4o");
  });

  it("从 agent_end 提取 provider 错误，避免误报无文本回复", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "你好" }] },
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "401 Authentication Fails",
      },
    ];
    expect(extractLastAssistantText(messages)).toBe("");
    expect(extractLastAssistantError(messages)).toBe("401 Authentication Fails");
  });

  it("Agent 工具包装层强制用户身份并可执行真实工具", async () => {
    const userId = freshUser("wrapped_tool");
    store.clearUserData(userId);
    const wrapped = wrapToolsForUser(userId, [logMealTool])[0];
    const prepared = wrapped.prepareArguments?.({
      userId: "attacker",
      mealType: "dinner",
      foods: [{ name: "番茄炒蛋", amount: "1份" }],
    }) as { userId: string; mealType: string; foods: Array<{ name: string; amount: string }> };
    expect(prepared.userId).toBe(userId);
    await wrapped.execute("wrapped-log-meal", prepared, undefined, undefined, EMPTY_EXTENSION_CONTEXT);
    expect(store.getMealLogsByDate(userId)).toHaveLength(1);
    expect(store.getMealLogsByDate("attacker")).toHaveLength(0);
  });

  it("工具遇到瞬时数据库锁时自动重试，永久错误不重复执行", async () => {
    const transientExecute = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }))
      .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const transient = wrapToolsForUser("u1", [{
      name: "transient_db_tool",
      label: "transient",
      description: "test",
      parameters: {} as any,
      execute: transientExecute,
    } as any])[0];
    await expect(transient.execute("call", {}, undefined, undefined, EMPTY_EXTENSION_CONTEXT))
      .resolves.toMatchObject({ content: [{ text: "ok" }] });
    expect(transientExecute).toHaveBeenCalledTimes(2);

    const permanentExecute = vi.fn().mockRejectedValue(new Error("constraint failed"));
    const permanent = wrapToolsForUser("u1", [{
      name: "permanent_db_tool",
      label: "permanent",
      description: "test",
      parameters: {} as any,
      execute: permanentExecute,
    } as any])[0];
    await expect(permanent.execute("call", {}, undefined, undefined, EMPTY_EXTENSION_CONTEXT))
      .rejects.toThrow("constraint failed");
    expect(permanentExecute).toHaveBeenCalledOnce();
  });
});

describe("隐私与调试配置", () => {
  it("请求日志默认关闭，不替换全局 fetch", () => {
    const originalFetch = globalThis.fetch;
    const previous = process.env.ENABLE_REQUEST_LOGGING;
    delete process.env.ENABLE_REQUEST_LOGGING;
    installRequestLogger();
    expect(globalThis.fetch).toBe(originalFetch);
    if (previous === undefined) delete process.env.ENABLE_REQUEST_LOGGING;
    else process.env.ENABLE_REQUEST_LOGGING = previous;
  });
});
