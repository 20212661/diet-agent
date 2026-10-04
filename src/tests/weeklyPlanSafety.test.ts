import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WeeklyDayPlan } from "../types/diet.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const { generateWeeklyPlanTool } = await import("../tools/generateWeeklyPlan.js");
const { generateCookingPlanTool } = await import("../tools/generateCookingPlan.js");
const { getMealPlanTool } = await import("../tools/getMealPlan.js");
const { mealFitsTimeLimits } = await import("../recipes/mealTiming.js");
const runWeeklyPlan = (params: Parameters<typeof generateWeeklyPlanTool.execute>[1]) =>
  generateWeeklyPlanTool.execute("weekly-test", params, undefined, undefined, {} as ExtensionContext);
const runCookingPlan = (params: Parameters<typeof generateCookingPlanTool.execute>[1]) =>
  generateCookingPlanTool.execute("cooking-test", params, undefined, undefined, {} as ExtensionContext);
const runGetMealPlan = (params: Parameters<typeof getMealPlanTool.execute>[1]) =>
  getMealPlanTool.execute("get-meal-plan-test", params, undefined, undefined, {} as ExtensionContext);

const baseDay = (recipe: ReturnType<typeof store.getRecipeBook>[number], date: string) => ({
  dayOfWeek: 1,
  date,
  mainRecipe: { id: recipe.id, name: recipe.name, activeMinutes: recipe.activeMinutes, totalMinutes: recipe.totalMinutes },
  staplesSuggestion: "米饭",
  reasons: [],
  missingIngredients: [],
  completed: false,
});

describe("读取周计划时重新验证安全与设备条件", () => {
  beforeEach(() => store.closeDatabase());

  it("附加备菜与低能量文案也遵守大豆过敏和临时忌口", async () => {
    const userId = "advice_allergy";
    store.upsertUserProfile(userId, { allergies: ["大豆"], avoidFoods: ["花生"] });
    store.upsertIngredientInventory(userId, { availableIngredients: ["鸡蛋", "番茄", "盐", "糖", "橄榄油"] });
    const recipe = store.getRecipeBook().find((item) => item.name === "番茄炒蛋")!;
    store.upsertRecipe({ ...recipe, lowEnergySwap: "改用花生酱拌饭", weekendPrep: "用生抽腌肉" });
    const result = await runCookingPlan({ userId, energyLevel: "low" });
    expect(result.details).toMatchObject({ status: "matched" });
    const advice = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n").split("## 低能量版本")[1];
    expect(advice).not.toMatch(/花生酱|生抽|蚝油/);
    expect(advice).toContain("不另加未经核实的配料");
  });

  it("默认腌料建议不能绕过大豆过敏", async () => {
    const userId = "default_advice_allergy";
    store.upsertUserProfile(userId, { allergies: ["大豆"] });
    store.upsertIngredientInventory(userId, { availableIngredients: ["鸡蛋", "番茄", "盐", "糖", "橄榄油"] });
    const result = await runCookingPlan({ userId });
    const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    expect(text.split("## 明天/周末预处理建议")[1]).not.toMatch(/生抽|蚝油/);
  });

  it("两道菜合计超过整餐时间限制时不安排配菜", () => {
    const limits = { maxActiveMinutes: 20, maxTotalMinutes: 35 };
    expect(mealFitsTimeLimits({ activeMinutes: 15, totalMinutes: 25 }, { activeMinutes: 10, totalMinutes: 20 }, limits)).toBe(false);
    expect(mealFitsTimeLimits({ activeMinutes: 12, totalMinutes: 20 }, { activeMinutes: 8, totalMinutes: 15 }, limits)).toBe(true);
  });

  it("用户新增过敏后，不再把已保存的冲突菜谱作为可执行晚饭返回", () => {
    const userId = "plan_safety_allergy";
    const recipe = store.getRecipeBook().find((item) => item.allergenTags?.includes("peanut"));
    expect(recipe).toBeTruthy();
    store.upsertKitchenProfile(userId, {
      burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
      cookware: ["炒锅", "汤锅", "烤盘", "保鲜袋"], maxActiveMinutes: 30, maxTotalMinutes: 60,
    });
    store.upsertWeeklyPlan(userId, "2026-09-21", [baseDay(recipe!, "2026-09-21")]);

    store.upsertUserProfile(userId, { allergies: ["花生"] });
    const plan = store.getWeeklyPlan(userId, "2026-09-21");

    expect(plan?.days[0]).toMatchObject({
      executionBlockedReason: expect.stringContaining("过敏"),
      mainRecipe: { id: recipe!.id, name: "需重新安排" },
      sideRecipe: undefined,
    });
  });

  it("厨房设备变化后，不再把需要已移除设备的菜谱作为可执行晚饭返回", () => {
    const userId = "plan_safety_appliance";
    const recipe = store.getRecipeBook().find((item) => item.appliances.includes("stove"));
    expect(recipe).toBeTruthy();
    store.upsertKitchenProfile(userId, {
      burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
      cookware: ["炒锅", "汤锅", "烤盘", "保鲜袋"], maxActiveMinutes: 30, maxTotalMinutes: 60,
    });
    store.upsertWeeklyPlan(userId, "2026-09-21", [baseDay(recipe!, "2026-09-21")]);

    store.upsertKitchenProfile(userId, { burners: 0, hasOven: false, hasMicrowave: false, hasRiceCooker: false, cookware: [] });
    const plan = store.getWeeklyPlan(userId, "2026-09-21");

    expect(plan?.days[0]).toMatchObject({
      executionBlockedReason: expect.stringContaining("设备"),
      mainRecipe: { id: recipe!.id, name: "需重新安排" },
    });
  });

  it("配菜变为过敏冲突后，不再把它的食材列入采购项", () => {
    const userId = "plan_safety_side_allergy";
    const recipes = store.getRecipeBook();
    const side = recipes.find((item) => item.allergenTags?.includes("peanut"))!;
    const main = recipes.find((item) => item.name === "番茄炒蛋")!;
    expect(main).toBeTruthy();
    expect(side).toBeTruthy();
    store.upsertKitchenProfile(userId, {
      burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
      cookware: ["炒锅", "汤锅", "烤盘", "保鲜袋"], maxActiveMinutes: 120, maxTotalMinutes: 180,
    });
    store.upsertWeeklyPlan(userId, "2026-09-21", [{
      ...baseDay(main, "2026-09-21"),
      sideRecipe: { id: side.id, name: side.name, activeMinutes: side.activeMinutes, totalMinutes: side.totalMinutes },
    }]);
    store.upsertUserProfile(userId, { allergies: ["花生"] });

    const day = store.getWeeklyPlan(userId, "2026-09-21")?.days[0];
    expect(day?.sideRecipe).toBeUndefined();
    expect(day?.ingredientReadiness?.map((item) => item.ingredient)).toEqual(main.ingredients);
    expect(day?.missingIngredients).toEqual(main.ingredients);
  });

  it("周计划只选择满足厨房时间上限的菜谱，并校验日期与星期", async () => {
    const userId = "plan_hard_time_limit";
    store.upsertKitchenProfile(userId, { maxActiveMinutes: 10, maxTotalMinutes: 20 });
    const result = await runWeeklyPlan({
      userId, weekStartDate: "2026-09-21",
    });
    const days = (result.details as { days: WeeklyDayPlan[] }).days;
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((day) =>
      day.mainRecipe.activeMinutes <= 10 && day.mainRecipe.totalMinutes <= 20
      && day.mainRecipe.activeMinutes + (day.sideRecipe?.activeMinutes ?? 0) <= 10
      && day.mainRecipe.totalMinutes + (day.sideRecipe?.totalMinutes ?? 0) <= 20)).toBe(true);
    await expect(runWeeklyPlan({ userId, weekStartDate: "2026-02-30" }))
      .rejects.toThrow("weekStartDate");
    await expect(runWeeklyPlan({ userId, avoidDays: [0] }))
      .rejects.toThrow("avoidDays");
    await expect(runWeeklyPlan({
      userId, energyOverrides: [{ dayOfWeek: 8, energyLevel: "low" }],
    })).rejects.toThrow("energyOverrides");
  });

  it("没有符合时间上限的菜谱时保留原周计划", async () => {
    const userId = "plan_no_time_match";
    const recipe = store.getRecipeBook().find((item) => item.name === "番茄炒蛋")!;
    store.upsertWeeklyPlan(userId, "2026-09-21", [baseDay(recipe, "2026-09-21")]);
    store.upsertKitchenProfile(userId, { maxActiveMinutes: 1, maxTotalMinutes: 1 });
    const result = await runWeeklyPlan({ userId, weekStartDate: "2026-09-21" });
    expect(result.details).toMatchObject({ status: "no_match", days: [] });
    const row = store.getDatabase().prepare("SELECT days_json FROM weekly_plans WHERE user_id = ? AND week_start_date = ?")
      .get(userId, "2026-09-21") as { days_json: string };
    expect(JSON.parse(row.days_json)[0].mainRecipe.id).toBe(recipe.id);
  });

  it("单灶台下同时安排主配菜时，厨具安排明确提示单灶错峰执行", async () => {
    const userId = "single_burner_cook";
    store.upsertKitchenProfile(userId, { burners: 1, hasOven: false, maxActiveMinutes: 60, maxTotalMinutes: 90 });
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "鸡蛋", status: "available" },
        { name: "西红柿", status: "available" },
        { name: "青菜", status: "available" },
        { name: "蒜", status: "available" },
        { name: "米饭", status: "available" },
      ],
      replaceAvailable: true,
    });
    const result = await runCookingPlan({ userId });
    const text = (result.content[0] as { text: string }).text;
    if (text.includes("配菜：")) {
      expect(text).toContain("灶台 1（单灶错峰）：先制作");
    }
  });

  it("已完成的周计划日发生过敏或设备冲突被阻断后，completed 状态自动失效且不计入完成天数", async () => {
    const userId = "plan_completed_blocked";
    const recipe = store.getRecipeBook().find((item) => item.name === "番茄炒蛋")!;
    const plan = store.upsertWeeklyPlan(userId, "2026-09-21", [baseDay(recipe, "2026-09-21")]);
    const completedResult = store.setWeeklyPlanDayCompleted(userId, "2026-09-21", "2026-09-21", recipe.id, plan.updatedAt, true);
    expect(completedResult.status).toBe("updated");
    expect((completedResult as { plan: { days: WeeklyDayPlan[] } }).plan.days[0]!.completed).toBe(true);

    // 新增过敏原冲突
    store.upsertUserProfile(userId, { allergies: [recipe.ingredients[0]!] });
    const blockedPlan = store.getWeeklyPlan(userId, "2026-09-21")!;
    expect(blockedPlan.days[0]!.executionBlockedReason).toBeTruthy();
    expect(blockedPlan.days[0]!.completed).toBe(false);
    expect(blockedPlan.days[0]!.completedAt).toBeUndefined();
  });

  it("试图将处于阻断状态的周计划日标记为完成时返回 conflict", async () => {
    const userId = "plan_blocked_cannot_complete";
    const recipe = store.getRecipeBook().find((item) => item.name === "番茄炒蛋")!;
    const plan = store.upsertWeeklyPlan(userId, "2026-09-21", [baseDay(recipe, "2026-09-21")]);
    store.upsertUserProfile(userId, { allergies: [recipe.ingredients[0]!] });

    const attempt = store.setWeeklyPlanDayCompleted(userId, "2026-09-21", "2026-09-21", recipe.id, plan.updatedAt, true);
    expect(attempt.status).toBe("conflict");
  });

  it("getMealPlan 拒绝非法格式或不存在的 ISO 日期（如 2026-02-30）", async () => {
    await expect(runGetMealPlan({ userId: "date_test", date: "2026-02-30" }))
      .rejects.toThrow("date 必须是有效的 YYYY-MM-DD 日期。");
    await expect(runGetMealPlan({ userId: "date_test", date: "invalid-date" }))
      .rejects.toThrow("date 必须是有效的 YYYY-MM-DD 日期。");
  });
});
