/**
 * 家庭多人排菜（PR C）：resolveDiningMembers 解析、过敏/忌口并集硬过滤、
 * 口味按"填了偏好的成员数"归一加权（单人行为不变）、任务状态 diningMembers
 * 确定性字段与注入、已删除成员在重放中被忽略。
 */
import { describe, expect, it } from "vitest";
import type { MealPlan, RecipeRecord, WeeklyDayPlan } from "../types/diet.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { generateMealPlanTool } = await import("../tools/generateMealPlan.js");
const {
  resolveDiningMembers,
  diningMemberNames,
  diningProfileForMatching,
} = await import("../services/household.js");
const { matchRecipesDetailed } = await import("../recipes/recipeMatcher.js");
const { noteMealPlanToolCall } = await import("../tasks/taskStateService.js");
const { buildTaskStateInjection } = await import("../tasks/taskStateInjection.js");
const context = {} as never;

const kitchen = { userId: "", burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
  cookware: ["炒锅", "汤锅"], maxActiveMinutes: 60, maxTotalMinutes: 90, tastePreferences: [], cookingPreferences: [], updatedAt: "" };

function recipe(overrides: Partial<RecipeRecord>): RecipeRecord {
  return {
    id: "r_test", name: "辣炒鸡丁", mode: "quick", ingredients: ["鸡肉"], mealTypes: ["dinner"],
    modes: [], suitableGoals: [], optionalIngredients: [], vegetables: [], staples: [],
    cookware: ["炒锅"], appliances: ["stove"], activeMinutes: 10, totalMinutes: 20,
    difficulty: 2, dishCount: 2, steps: [], tasteTags: ["辣"], updatedAt: "",
    ...overrides,
  } as RecipeRecord;
}

describe("resolveDiningMembers", () => {
  it("空引用=全部成员；接受 memberId/名字/'我'/'self'；去重保序", () => {
    const userId = "hd_resolve_1";
    store.upsertUserProfile(userId, { allergies: ["牛奶"] });
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });
    store.upsertHouseholdMember(userId, undefined, { name: "小红" });

    expect(resolveDiningMembers(userId)).toHaveLength(3); // 我 + 小明 + 小红
    expect(resolveDiningMembers(userId, ["self"])).toHaveLength(1);
    expect(resolveDiningMembers(userId, ["我"])).toHaveLength(1);
    expect(resolveDiningMembers(userId, ["小明", "小红"])).toHaveLength(2);
    expect(resolveDiningMembers(userId, [xiaoming.memberId, "小明"])).toHaveLength(1); // ID 与名字同一人去重
    expect(resolveDiningMembers(userId, ["我", "小明"])).toHaveLength(2);
  });

  it("已删除成员引用默认忽略不抛错；strict 模式对未知引用抛错；引用全部失效回退为仅'我'", () => {
    const userId = "hd_resolve_2";
    store.upsertUserProfile(userId, {});
    const gone = store.upsertHouseholdMember(userId, undefined, { name: "小明" });
    store.removeHouseholdMember(userId, gone.memberId);

    // 计划里保存过的成员 ID 现已删除：重放忽略（ignore 默认）
    const replayed = resolveDiningMembers(userId, ["self", gone.memberId]);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.isSelf).toBe(true);

    // 全部引用失效：保守回退为"仅我"（不能落成空集=无过滤）
    expect(resolveDiningMembers(userId, ["不存在的成员"])).toHaveLength(1);

    // strict（工具入口）：未知引用抛错让模型修正
    expect(() => resolveDiningMembers(userId, ["妈妈"], { onUnresolved: "strict" })).toThrow("未找到用餐成员");
    // strict 下已删除成员同样报错（模型应重新查询成员列表）
    expect(() => resolveDiningMembers(userId, [gone.memberId], { onUnresolved: "strict" })).toThrow("未找到用餐成员");
  });
});

describe("用餐成员并集硬过滤", () => {
  it("成员过敏原参与排菜过滤：默认全成员（小明过敏虾→无虾模板）；指定仅'我'后虾模板可用", async () => {
    const userId = "hd_filter_1";
    store.upsertUserProfile(userId, { goal: "muscle_gain", allergies: ["牛奶"] });
    store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });

    // 全员用餐：增肌模板含"虾 200g"晚餐，应被小明的过敏排除
    const all = await generateMealPlanTool.execute("t", { userId, startDate: "2030-04-08", days: 1, target: "增肌" }, undefined, undefined, context);
    const allIngredients = (all.details as { days: MealPlan["days"] }).days.flatMap((d) => d.meals.flatMap((m) => m.ingredients));
    expect(allIngredients.some((name) => name.includes("虾"))).toBe(false);
    expect(allIngredients.some((name) => name.includes("牛奶"))).toBe(false); // "我"的过敏同样生效

    // 计划保存了用餐成员（全员=self+小明）
    expect(store.getMealPlanByStartDate(userId, "2030-04-08")?.diningMembers).toEqual(["self", expect.stringMatching(/^m_/)]);

    // 只有"我"吃：虾模板不再被排除
    const solo = await generateMealPlanTool.execute("t", { userId, startDate: "2030-04-10", days: 1, target: "增肌", diningMembers: ["我"] }, undefined, undefined, context);
    expect(store.getMealPlanByStartDate(userId, "2030-04-10")?.diningMembers).toEqual(["self"]);
    const soloIngredients = (solo.details as { days: MealPlan["days"] }).days.flatMap((d) => d.meals.flatMap((m) => m.ingredients));
    expect(soloIngredients.some((name) => name.includes("牛奶"))).toBe(false); // 我的过敏仍在
  });

  it("diningProfileForMatching：并集过敏/忌口，\"我\"的健康字段保留", () => {
    const userId = "hd_profile_1";
    store.upsertUserProfile(userId, { allergies: ["牛奶"], avoidFoods: ["香菜"], goal: "fat_loss", medicalNotes: ["高血压"] });
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });
    const members = resolveDiningMembers(userId, ["self", xiaoming.memberId]);
    const profile = diningProfileForMatching(userId, members);
    expect(profile.allergies).toEqual(expect.arrayContaining(["牛奶", "虾"]));
    expect(profile.avoidFoods).toEqual(["香菜"]);
    expect(profile.goal).toBe("fat_loss"); // 单人语义字段不动
    expect(profile.medicalNotes).toEqual(["高血压"]);
  });
});

describe("口味成员等权（命中人数 ÷ 填了口味的用餐成员数，上限 4）", () => {
  const spicy = recipe({});
  const sweet = recipe({ id: "r_sweet", name: "糖醋鸡丁", tasteTags: ["甜"] });
  const spicySweet = recipe({ id: "r_both", name: "宫保鸡丁", tasteTags: ["辣", "甜"] });
  const selfL = { memberId: "self", name: "我", isSelf: true, allergies: [], avoidFoods: [], preferences: [] };
  const xiaomingL = { memberId: "m_aaaaaaaa", name: "小明", isSelf: false, allergies: [], avoidFoods: [], preferences: ["辣"] };
  const xiaohongS = { memberId: "m_bbbbbbbb", name: "小红", isSelf: false, allergies: [], avoidFoods: [], preferences: ["甜"] };

  const plain = recipe({ id: "r_plain", name: "白切鸡", tasteTags: [] });
  const run = (kitchenTaste: string[], dining: unknown, target: RecipeRecord = spicy) =>
    matchRecipesDetailed({
      recipes: [target], availableIngredients: [{ name: "鸡肉" }], shoppingList: [],
      kitchenProfile: { ...kitchen, tastePreferences: kitchenTaste }, feedback: [],
      ...(dining !== undefined ? { diningMembers: dining as never } : {}),
    }).matches[0]!;
  /** 同条件下无口味标签的菜作基线：分差即纯口味分。 */
  const tasteBonus = (kitchenTaste: string[], dining: unknown, target: RecipeRecord = spicy) =>
    run(kitchenTaste, dining, target).score - run(kitchenTaste, dining, plain).score;

  it("单人（不传 diningMembers）命中得 4，与旧口径逐字节一致", () => {
    const result = run(["辣"], undefined);
    expect(result.reasons).toContain("符合口味偏好：辣");
    expect(tasteBonus(["辣"], undefined)).toBe(4);
    // 不传成员时不出现成员口径的理由行
    expect(result.reasons.every((reason) => !reason.includes("的口味偏好"))).toBe(true);
  });

  it("两人只有'我'填口味（厨房画像）且命中：得 4", () => {
    const noTasteXiaoming = { ...xiaomingL, preferences: [] };
    const result = run(["辣"], [selfL, noTasteXiaoming]);
    expect(tasteBonus(["辣"], [selfL, noTasteXiaoming])).toBe(4);
    expect(result.reasons).toContain("符合我的口味偏好");
  });

  it("两人都填都命中：得 4", () => {
    const result = run(["辣"], [selfL, xiaomingL]); // 我（厨房：辣）+ 小明（辣）
    expect(tasteBonus(["辣"], [selfL, xiaomingL])).toBe(4);
    expect(result.reasons).toContain("符合我、小明的口味偏好");
  });

  it("两人都填、一人命中：得 2", () => {
    const result = run(["辣"], [selfL, xiaohongS]); // 我命中（辣）、小红不命中（甜≠辣）
    expect(tasteBonus(["辣"], [selfL, xiaohongS])).toBe(2);
    expect(result.reasons).toContain("符合我的口味偏好");
    expect(result.reasons.join()).not.toContain("小红");
  });

  it("'我'不在用餐成员时厨房口味不参与：只按在场成员计算", () => {
    // 厨房口味是"甜"（只属于"我"），但"我"不在场：甜命中不产生任何口味分
    const onlyXiaoming = run(["甜"], [xiaomingL], spicy); // 小明（辣）命中辣
    expect(tasteBonus(["甜"], [xiaomingL], spicy)).toBe(4); // 命中小明 → 满分，厨房"甜"未叠加
    expect(onlyXiaoming.reasons).toContain("符合小明的口味偏好");
    // 反向：只有厨房口味能命中的菜（甜），"我"不在场时得 0 分口味
    expect(tasteBonus(["甜"], [xiaomingL], sweet)).toBe(0);
  });

  it("一道菜命中某成员多项偏好仍按一次计", () => {
    const greedy = { ...xiaomingL, preferences: ["辣", "甜"] }; // 两项都命中 spicySweet
    expect(tasteBonus([], [greedy], spicySweet)).toBe(4); // 不是 8
  });
});

describe("任务状态 diningMembers（确定性字段）", () => {
  it("排菜工具调用写入成员 ID；注入块显示成员名；已删除成员在名字解析中跳过", () => {
    const userId = "hd_task_1";
    store.upsertUserProfile(userId, {});
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明" });

    const task = noteMealPlanToolCall(userId, "generate_meal_plan", {
      ok: true, mealPlanStartDate: "2030-04-08", diningMembers: ["self", xiaoming.memberId],
    });
    expect(task.diningMembers).toEqual(["self", xiaoming.memberId]);

    const saved = store.getTaskState(userId, task.taskId)!;
    expect(saved.diningMembers).toEqual(["self", xiaoming.memberId]); // 持久化往返

    const block = buildTaskStateInjection(saved, { diningMemberNames: diningMemberNames(userId, saved.diningMembers!) });
    expect(block).toContain("本轮用餐成员：我、小明");

    // 成员删除后：名字解析跳过已删 ID，注入不再显示，且不抛错
    store.removeHouseholdMember(userId, xiaoming.memberId);
    expect(diningMemberNames(userId, saved.diningMembers!)).toEqual(["我"]);
    const afterDelete = buildTaskStateInjection(saved, { diningMemberNames: diningMemberNames(userId, saved.diningMembers!) });
    expect(afterDelete).toContain("本轮用餐成员：我");
    expect(afterDelete).not.toContain("小明");
  });

  it("已保存周计划引用已删除成员：读取重校验忽略该成员不抛错", () => {
    const userId = "hd_replay_1";
    store.upsertUserProfile(userId, { allergies: ["牛奶"] });
    const xiaoming = store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });
    const day: WeeklyDayPlan = {
      dayOfWeek: 1, date: "2030-04-08",
      mainRecipe: { id: "missing_recipe", name: "家常菜", activeMinutes: 10, totalMinutes: 20 },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], ingredientReadiness: [], completed: false,
    };
    store.upsertWeeklyPlan(userId, "2030-04-08", [day], ["self", xiaoming.memberId]);
    store.removeHouseholdMember(userId, xiaoming.memberId);

    const plan = store.getWeeklyPlan(userId, "2030-04-08"); // 不抛错；重放按 [self] 过滤
    expect(plan?.diningMembers).toEqual(["self", xiaoming.memberId]); // 历史记录原样保留
    expect(plan?.days[0]?.mainRecipe.name).toBe("需重新安排"); // recipe 不存在的既有语义
  });
});
