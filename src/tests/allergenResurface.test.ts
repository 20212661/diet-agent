/**
 * 被忽略过敏原警告的跨成员重提示（PR D）：
 * 纯函数命中/已确认跳过、推荐场景 needs_verification 拦截（写明成员）、
 * 查看场景 mine 列表提示条 + "已为某成员确认"端点写回。
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { DismissedAllergenWarning, MealPlanDay, RecipeRecord, WeeklyDayPlan } from "../types/diet.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { resurfaceDismissedWarnings, resurfaceReason } = await import("../recipes/allergenResurface.js");
const { matchRecipesDetailed } = await import("../recipes/recipeMatcher.js");

const kitchen = { userId: "", burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
  cookware: ["炒锅", "汤锅"], maxActiveMinutes: 60, maxTotalMinutes: 90, tastePreferences: [], cookingPreferences: [], updatedAt: "" };

const warning = (overrides: Partial<DismissedAllergenWarning> = {}): DismissedAllergenWarning => ({
  ingredient: "虾", definitionId: "def_shrimp", allergens: ["shellfish"], possibleAllergens: [],
  confirmedByMemberIds: ["self"], dismissedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const SELF = { memberId: "self", name: "我", isSelf: true, allergies: [], avoidFoods: [], preferences: [] };
const member = (id: string, name: string, allergies: string[]) => ({
  memberId: id, name, isSelf: false, allergies, avoidFoods: [], preferences: [],
});

function recipeWith(overrides: Partial<RecipeRecord>): RecipeRecord {
  return {
    id: "r_warn", name: "家常虾滑", mode: "quick", ingredients: ["虾滑"], mealTypes: ["dinner"],
    modes: [], suitableGoals: [], optionalIngredients: [], vegetables: [], staples: [],
    cookware: ["炒锅"], appliances: ["stove"], activeMinutes: 10, totalMinutes: 20,
    difficulty: 2, dishCount: 2, steps: [], tasteTags: [], updatedAt: "",
    ...overrides,
  } as RecipeRecord;
}

describe("resurfaceDismissedWarnings（纯函数）", () => {
  it("未确认成员的过敏命中警告 → 重提示；已确认成员不参与", () => {
    const xiaoming = member("m_xiaoming", "小明", ["虾"]);
    const resurfaced = resurfaceDismissedWarnings([warning()], [SELF, xiaoming]);
    expect(resurfaced).toHaveLength(1);
    expect(resurfaced[0]).toMatchObject({ definitionId: "def_shrimp", ingredient: "虾", allergens: ["shellfish"] });
    expect(resurfaced[0]!.affectedMembers).toEqual([{ memberId: "m_xiaoming", name: "小明" }]);
    expect(resurfaceReason(resurfaced[0]!)).toContain("涉及 小明 的过敏且未确认");

    // 小明确认后：不再重提示
    const confirmed = resurfaceDismissedWarnings([warning({ confirmedByMemberIds: ["self", "m_xiaoming"] })], [SELF, xiaoming]);
    expect(confirmed).toEqual([]);
  });

  it("possibleAllergens（可能含）同样参与命中；成员过敏文本按宽松口径展开（\"虾\"→shellfish）", () => {
    const possibleOnly = warning({ definitionId: "def_mayo", ingredient: "沙拉酱", allergens: [], possibleAllergens: ["egg"] });
    const xiaohong = member("m_hong", "小红", ["鸡蛋"]);
    const resurfaced = resurfaceDismissedWarnings([possibleOnly], [SELF, xiaohong]);
    expect(resurfaced).toHaveLength(1);
    expect(resurfaced[0]!.affectedMembers).toEqual([{ memberId: "m_hong", name: "小红" }]);
  });

  it("无过敏交集或成员过敏为空 → 不命中", () => {
    const noOverlap = resurfaceDismissedWarnings([warning()], [SELF, member("m_milk", "小明", ["牛奶"])]);
    expect(noOverlap).toEqual([]);
    const noAllergies = resurfaceDismissedWarnings([warning()], [SELF, member("m_none", "小明", [])]);
    expect(noAllergies).toEqual([]);
  });
});

describe("推荐场景 needs_verification 拦截", () => {
  const base = (recipe: RecipeRecord, dining?: unknown) => ({
    recipes: [recipe], availableIngredients: [{ name: "虾滑" }], shoppingList: [],
    kitchenProfile: kitchen, feedback: [],
    ...(dining !== undefined ? { diningMembers: dining as never } : {}),
  });

  it("未确认成员在用餐名单：菜被排除且 blocker 写明成员；确认后放行", () => {
    const recipe = recipeWith({ dismissedAllergenWarnings: [warning()] });
    const xiaoming = member("m_xiaoming", "小明", ["虾"]);

    const blocked = matchRecipesDetailed(base(recipe, [SELF, xiaoming]));
    expect(blocked.matches).toHaveLength(0);
    expect(blocked.blockingReasons.some((reason) => reason.includes("涉及 小明 的过敏"))).toBe(true);

    // 全员确认后不再拦截
    const cleared = recipeWith({ dismissedAllergenWarnings: [warning({ confirmedByMemberIds: ["self", "m_xiaoming"] })] });
    const passed = matchRecipesDetailed(base(cleared, [SELF, xiaoming]));
    expect(passed.matches).toHaveLength(1);
  });

  it("单人旧调用（不传 diningMembers）不启用重提示——忽略人本人已确认", () => {
    const recipe = recipeWith({ dismissedAllergenWarnings: [warning()] });
    const solo = matchRecipesDetailed(base(recipe));
    expect(solo.matches).toHaveLength(1);
  });

  it("该成员不在本次用餐名单：其他人未受影响不拦", () => {
    const recipe = recipeWith({ dismissedAllergenWarnings: [warning()] });
    const xiaoming = member("m_xiaoming", "小明", ["虾"]);
    const onlySelf = matchRecipesDetailed(base(recipe, [SELF])); // 小明今晚不在
    expect(onlySelf.matches).toHaveLength(1);
    void xiaoming;
  });
});

describe("查看场景：mine 提示条与按成员确认（web 端点）", () => {
  // 预先加载 web 依赖链（含 agent 全家桶），测试体内不再有首次 import 开销（it 保持默认超时）；
  // 全量运行时这次加载本身可能超 beforeAll 默认 10s，单独放宽
  let createWebServer: typeof import("../web/server.js")["createWebServer"];
  beforeAll(async () => {
    ({ createWebServer } = await import("../web/server.js"));
  }, 30_000);

  it("mine 列表返回 resurfacedWarnings；确认后写回并消失", async () => {
    const userId = `resurface_${randomUUID().slice(0, 8)}`;
    store.upsertUserProfile(userId, { allergies: ["牛奶"] });
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });

    const record = recipeWith({
      id: "usr_test01", name: "家常虾滑",
      dismissedAllergenWarnings: [warning()],
      updatedAt: "",
    });
    store.upsertUserRecipe(userId, record);

    const server = createWebServer({ userId, host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(userId) };
    try {
      const mine = await (await fetch(`${base}/api/recipes/mine`)).json() as { recipes: Array<{ id: string; resurfacedWarnings?: unknown[] }> };
      const entry = mine.recipes.find((item) => item.id === "usr_test01")!;
      expect(entry.resurfacedWarnings).toHaveLength(1);

      const confirmed = await fetch(`${base}/api/recipes/mine/usr_test01/warning-confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ operationId: "resurface-confirm-1", definitionId: "def_shrimp", memberId: xiaoming.memberId }),
      });
      expect(confirmed.status).toBe(200);
      const savedRecipe = store.getUserRecipeById(userId, "usr_test01")!;
      expect(savedRecipe.dismissedAllergenWarnings![0]!.confirmedByMemberIds).toEqual(["self", xiaoming.memberId]);

      const after = await (await fetch(`${base}/api/recipes/mine`)).json() as { recipes: Array<{ id: string; resurfacedWarnings?: unknown[] }> };
      expect(after.recipes.find((item) => item.id === "usr_test01")!.resurfacedWarnings).toBeUndefined();

      // 无效成员被拒绝
      const invalid = await fetch(`${base}/api/recipes/mine/usr_test01/warning-confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ operationId: "resurface-confirm-2", definitionId: "def_shrimp", memberId: "m_nobody00" }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("已保存计划的重校验：成员后来加上被关闭过的过敏原", () => {
  // 场景口径：导入时原文出现"虾"（如虾粉调味）被用户判定与菜无关——不在食材面
  // （assessFoodSafety 对它是 clear 的），只留在 dismissed 警告里
  const shrimpRecipe = (id: string) => recipeWith({
    id, name: "家常鸡肉丸", ingredients: ["鸡肉"],
    dismissedAllergenWarnings: [warning()],
  });

  it("日计划：保存时成员无过敏可入计划；之后加上过敏，读回标记需确认并写明成员", () => {
    const userId = `revalidate_mp_${randomUUID().slice(0, 8)}`;
    store.upsertUserProfile(userId, {});
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明" }); // 保存时无过敏
    const recipe = shrimpRecipe("usr_reval01");
    store.upsertUserRecipe(userId, recipe);

    const day: MealPlanDay = {
      date: "2030-04-08",
      meals: [{
        mealType: "dinner", source: "recipe", name: recipe.name, recipeId: recipe.id,
        ingredients: recipe.ingredients, activeMinutes: recipe.activeMinutes, totalMinutes: recipe.totalMinutes,
        appliances: recipe.appliances, cookware: recipe.cookware, missingIngredients: [], reasons: [],
      }],
    };
    store.upsertMealPlan(userId, "2030-04-08", [day], { diningMembers: ["self", xiaoming.memberId] });
    expect(store.getMealPlan(userId, "2030-04-08")?.days[0]?.meals[0]?.executionBlockedReason).toBeUndefined();

    // 之后给小明加上"虾"过敏：读回重校验 → 标记需确认，理由写明小明
    store.upsertHouseholdMember(userId, xiaoming.memberId, { allergies: ["虾"] });
    const blocked = store.getMealPlan(userId, "2030-04-08")?.days[0]?.meals[0];
    expect(blocked?.source).toBe("unavailable");
    expect(blocked?.executionBlockedReason).toContain("涉及 小明 的过敏且未确认");
  });

  it("周计划：同样标记需确认；换菜与备选菜列表也拦截该菜", async () => {
    const userId = `revalidate_wp_${randomUUID().slice(0, 8)}`;
    store.upsertUserProfile(userId, {});
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小红" });
    const shrimp = shrimpRecipe("usr_reval02");
    const safe = recipeWith({ id: "usr_safe002", name: "清炒时蔬", ingredients: ["青菜"], dismissedAllergenWarnings: undefined });
    store.upsertUserRecipe(userId, shrimp);
    store.upsertUserRecipe(userId, safe);

    const dayPlan: WeeklyDayPlan = {
      dayOfWeek: 1, date: "2030-04-08",
      mainRecipe: { id: shrimp.id, name: shrimp.name, activeMinutes: shrimp.activeMinutes, totalMinutes: shrimp.totalMinutes },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], ingredientReadiness: [], completed: false,
    };
    store.upsertWeeklyPlan(userId, "2030-04-08", [dayPlan], ["self", xiaoming.memberId]);
    expect(store.getWeeklyPlan(userId, "2030-04-08")?.days[0]?.executionBlockedReason).toBeUndefined();

    // 之后成员加上"虾"过敏：读回标记需确认并写明成员
    store.upsertHouseholdMember(userId, xiaoming.memberId, { allergies: ["虾"] });
    const blockedDay = store.getWeeklyPlan(userId, "2030-04-08")?.days[0];
    expect(blockedDay?.executionBlockedReason).toContain("涉及 小红 的过敏且未确认");
    expect(blockedDay?.mainRecipe.name).toBe("需重新安排");

    // 换菜/备选（走 matchRecipes 的拦截块）：被拦的菜不出现在备选里，也不允许换成它
    const { getWeeklyPlanAlternatives, replacePlanDayRecipe } = await import("../services/weeklyPlanService.js");
    const alternatives = getWeeklyPlanAlternatives(userId, "2030-04-08", "2030-04-08");
    expect(alternatives.status).toBe("ok");
    const candidateIds = alternatives.status === "ok" ? alternatives.alternatives.map((item) => item.recipe.id) : [];
    expect(candidateIds).not.toContain(shrimp.id); // 拦截：不出现在备选里
    expect(candidateIds.length).toBeGreaterThan(0);

    const plan = store.getWeeklyPlan(userId, "2030-04-08")!;
    const replace = replacePlanDayRecipe(userId, "2030-04-08", "2030-04-08", plan.updatedAt, shrimp.id);
    expect(replace).toMatchObject({ status: "invalid_recipe" }); // 拦截：不能换成涉及未确认成员过敏原的菜
    // 阳性对照：换成备选列表里的首项菜仍然可以
    const planAfterReject = store.getWeeklyPlan(userId, "2030-04-08")!;
    const okReplace = replacePlanDayRecipe(userId, "2030-04-08", "2030-04-08", planAfterReject.updatedAt, candidateIds[0]!);
    expect(okReplace).not.toMatchObject({ status: "invalid_recipe" });
    void safe;
  });
});
