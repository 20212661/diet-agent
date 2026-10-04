import { beforeEach, describe, expect, it } from "vitest";
import type { MealPlan } from "../types/diet.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const [store, tools] = await Promise.all([
  import("../store/index.js"),
  Promise.all([import("../tools/generateMealPlan.js"), import("../tools/getMealPlan.js")]),
]);
const { generateMealPlanTool } = tools[0];
const { getMealPlanTool } = tools[1];
const context = {} as never;

async function generate(params: Record<string, unknown>) {
  return generateMealPlanTool.execute("test-meal-plan", params as never, undefined, undefined, context);
}

describe("保存型饮食计划", () => {
  beforeEach(() => { store.closeDatabase(); store.clearUserData("meal-plan-test"); });

  it("按目标、库存和菜谱生成可复现计划，并能按日期读回", async () => {
    const userId = "meal-plan-test";
    store.upsertIngredientInventory(userId, {
      availableIngredients: [
        { name: "鸡腿", status: "available" },
        { name: "土豆", status: "available" },
        { name: "鸡蛋", status: "available" },
        { name: "米饭", status: "available" },
      ],
      replaceAvailable: true,
    });
    const params = { userId, startDate: "2030-04-08", days: 3, target: "减脂，清淡" };
    const first = await generate(params);
    const second = await generate(params);
    const firstPlan = (first.details as { days: MealPlan["days"] }).days;
    const secondPlan = (second.details as { days: MealPlan["days"] }).days;

    expect((first.details as { goal?: string }).goal).toBe("fat_loss");
    expect(firstPlan).toHaveLength(3);
    expect(firstPlan.map((day) => day.meals.map((meal) => meal.name))).toEqual(
      secondPlan.map((day) => day.meals.map((meal) => meal.name)),
    );
    expect(firstPlan.every((day) => day.meals.length === 4)).toBe(true);
    expect(store.getMealPlanByStartDate(userId, "2030-04-08")?.days).toEqual(firstPlan);

    const read = await getMealPlanTool.execute("test-read-meal-plan", { userId, date: "2030-04-09" }, undefined, undefined, context);
    expect(read.details).toMatchObject({ found: true, date: "2030-04-09" });
    expect((read.details as { day: { meals: unknown[] } }).day.meals).toHaveLength(4);
  });

  it("应用过敏和本次临时忌口，且临时忌口不会进入长期画像", async () => {
    const userId = "meal-plan-test";
    store.upsertUserProfile(userId, { allergies: ["花生"], avoidFoods: ["香菜"] });
    const result = await generate({
      userId,
      startDate: "2030-04-08",
      days: 2,
      temporaryAvoidFoods: ["鸡蛋"],
    });
    const days = (result.details as { days: MealPlan["days"] }).days;
    const ingredients = days.flatMap((day) => day.meals.flatMap((meal) => meal.ingredients));
    expect(ingredients.some((name) => /花生|鸡蛋|香菜/.test(name))).toBe(false);
    expect(store.getUserProfile(userId)?.avoidFoods).toEqual(["香菜"]);
    expect(store.getMealPlanByStartDate(userId, "2030-04-08")?.constraints?.temporaryAvoidFoods).toEqual(["鸡蛋"]);
    expect((result.content[0] as { text: string }).text).toContain("本次临时避开：鸡蛋");
  });

  it("对时间上限作硬过滤；没有匹配项时显示无法安排", async () => {
    const result = await generate({
      userId: "meal-plan-test",
      startDate: "2030-04-08",
      days: 1,
      timeLimitMinutes: 1,
    });
    const day = (result.details as { days: MealPlan["days"] }).days[0]!;
    expect(day.meals.every((meal) => meal.source === "unavailable")).toBe(true);
  });
  it("新增过敏后读回会阻止执行，解除后恢复且原始计划不被覆盖", async () => {
    const userId = "meal-plan-test";
    const result = await generate({ userId, startDate: "2030-04-08" });
    const days = (result.details as { days: MealPlan["days"] }).days;
    const original = days[0]!.meals.find((meal) => meal.source === "recipe")!;
    const ingredient = original.ingredients[0]!;
    store.upsertUserProfile(userId, { avoidFoods: [ingredient] });
    const blocked = store.getMealPlan(userId, "2030-04-08")!.days[0]!.meals.find((meal) => meal.recipeId === original.recipeId)!;
    expect(blocked.source).toBe("unavailable");
    expect(blocked.executionBlockedReason).toBeTruthy();
    expect(blocked.ingredients).toEqual([]);
    const read = await getMealPlanTool.execute("read", { userId, date: "2030-04-08" }, undefined, undefined, context);
    expect((read.content[0] as { text: string }).text).toContain("需重新安排");
    store.upsertUserProfile(userId, { avoidFoods: [] });
    expect(store.getMealPlanByStartDate(userId, "2030-04-08")!.days[0]!.meals.find((meal) => meal.recipeId === original.recipeId)!.source).toBe("recipe");
  });

  it("未来日期按到期日重算库存，采购清单不算已经拥有", async () => {
    const userId = "meal-plan-test";
    store.upsertIngredientInventory(userId, { availableIngredients: [{ name: "黄瓜", expiresAt: "2030-04-08" }],
      shoppingList: [{ name: "蒜" }], replaceAvailable: true });
    const base = store.getRecipeBook()[0]!;
    store.getDatabase().prepare("UPDATE recipe_book SET meal_types_json = '[]'").run();
    store.upsertRecipe({ ...base, id: "date-probe", name: "日期测试黄瓜", ingredients: ["黄瓜", "蒜"],
      optionalIngredients: [], staples: [], vegetables: [], primaryProtein: undefined, allergenTags: [],
      cookware: [], appliances: [], activeMinutes: 2, totalMinutes: 4, mealTypes: ["lunch"] });
    const result = await generate({ userId, startDate: "2030-04-08", days: 2 });
    const days = (result.details as { days: MealPlan["days"] }).days;
    const lunch = (index: number) => days[index]!.meals.find((meal) => meal.mealType === "lunch")!;
    expect(lunch(0).missingIngredients).not.toContain("黄瓜");
    expect(lunch(0).missingIngredients).toContain("蒜");
    expect(lunch(1).missingIngredients).toContain("黄瓜");
    expect(store.getMealPlan(userId, "2030-04-09")!.days[1]!.meals.find((meal) => meal.mealType === "lunch")!.missingIngredients).toContain("黄瓜");
  });

  it("厨房总耗时上限同时约束菜谱和模板", async () => {
    const userId = "meal-plan-test";
    store.upsertKitchenProfile(userId, { maxTotalMinutes: 1 });
    const result = await generate({ userId });
    expect((result.details as { days: MealPlan["days"] }).days[0]!.meals.every((meal) => meal.source === "unavailable")).toBe(true);
  });

  it("无设备时模板不能安排烹饪，并重新校验已保存模板", async () => {
    const userId = "meal-plan-test";
    store.getRecipeBook();
    store.getDatabase().prepare("UPDATE recipe_book SET meal_types_json = '[]'").run();
    const saved = await generate({ userId, startDate: "2030-04-08" });
    expect((saved.details as { days: MealPlan["days"] }).days[0]!.meals.find((meal) => meal.mealType === "lunch")!.source).toBe("template");
    store.upsertKitchenProfile(userId, { burners: 0, hasOven: false, hasMicrowave: false, hasRiceCooker: false, cookware: [] });
    const read = store.getMealPlan(userId, "2030-04-08")!;
    expect(read.days[0]!.meals.find((meal) => meal.mealType === "lunch")!.executionBlockedReason).toBeTruthy();
    const result = await generate({ userId, startDate: "2030-04-09" });
    const meals = (result.details as { days: MealPlan["days"] }).days[0]!.meals;
    expect(meals.find((meal) => meal.mealType === "lunch")!.source).toBe("unavailable");
    expect(meals.find((meal) => meal.mealType === "snack")!.source).toBe("template");
  });

  it("降低时间上限后阻止执行旧计划，旧模板缺失设备信息需要重新生成", () => {
    const userId = "meal-plan-test";
    store.upsertMealPlan(userId, "2030-04-08", [{ date: "2030-04-08", meals: [{ mealType: "lunch", source: "template",
      name: "鸡肉 + 米饭", ingredients: ["鸡肉", "米饭"], activeMinutes: 15, missingIngredients: [], reasons: [] }] }]);
    expect(store.getMealPlanByStartDate(userId, "2030-04-08")!.days[0]!.meals[0]!.executionBlockedReason).toContain("旧模板");
  });

  it("已保存菜谱同时按最新设备、时间和菜谱内容重新校验", () => {
    const userId = "meal-plan-test";
    const recipe = store.getRecipeBook().find((item) => item.name === "番茄炒蛋")!;
    store.upsertMealPlan(userId, "2030-04-08", [{ date: "2030-04-08", meals: [{ mealType: "dinner", source: "recipe",
      recipeId: recipe.id, name: recipe.name, ingredients: recipe.ingredients, activeMinutes: recipe.activeMinutes,
      totalMinutes: recipe.totalMinutes, missingIngredients: [], reasons: [] }] }]);
    const read = () => store.getMealPlanByStartDate(userId, "2030-04-08")!.days[0]!.meals[0]!;
    store.upsertKitchenProfile(userId, { maxTotalMinutes: recipe.totalMinutes - 1 });
    expect(read().executionBlockedReason).toContain("耗时");
    store.upsertKitchenProfile(userId, { maxTotalMinutes: 60, burners: 0 });
    expect(read().executionBlockedReason).toContain("设备");
    store.upsertKitchenProfile(userId, { burners: 2 });
    expect(read().source).toBe("recipe");
    store.upsertUserProfile(userId, { allergies: ["花生"] });
    store.upsertRecipe({ ...recipe, ingredients: [...recipe.ingredients, "花生"], allergenTags: ["peanut"] });
    expect(read().executionBlockedReason).toContain("过敏");
    expect(read().ingredients).toEqual([]);
  });

});
