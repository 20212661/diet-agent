import { beforeEach, describe, expect, it } from "vitest";
import { matchRecipes } from "../recipes/recipeMatcher.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const service = await import("../services/weeklyPlanService.js");

describe("周计划菜谱替换", () => {
  beforeEach(() => store.closeDatabase());

  it("候选不重复，并在替换时检查版本和当前时间约束", () => {
    const userId = "weekly_service_replace";
    const kitchen = store.getKitchenProfile(userId);
    const recipes = matchRecipes({
      recipes: store.getRecipeBook(), availableIngredients: [], shoppingList: [],
      kitchenProfile: kitchen, feedback: [],
    }).filter((match) => match.recipe.activeMinutes <= kitchen.maxActiveMinutes
      && match.recipe.totalMinutes <= kitchen.maxTotalMinutes)
      .slice(0, 3).map((match) => match.recipe);
    expect(recipes).toHaveLength(3);
    const [first, second, third] = recipes;
    const day = (recipe: typeof first, date: string, dayOfWeek: number) => ({
      date, dayOfWeek,
      mainRecipe: { id: recipe!.id, name: recipe!.name, activeMinutes: recipe!.activeMinutes, totalMinutes: recipe!.totalMinutes },
      staplesSuggestion: "米饭", reasons: [], missingIngredients: [], completed: false,
    });
    store.upsertWeeklyPlan(userId, "2026-09-21", [
      day(first, "2026-09-21", 1), day(second, "2026-09-22", 2),
    ]);
    const plan = store.getWeeklyPlan(userId, "2026-09-21")!;
    const alternatives = service.getWeeklyPlanAlternatives(userId, "2026-09-21", "2026-09-21");
    expect(alternatives.status).toBe("ok");
    if (alternatives.status !== "ok") return;
    expect(alternatives.alternatives.map((item) => item.recipe.id)).not.toContain(second!.id);
    expect(alternatives.alternatives.map((item) => item.recipe.id)).toContain(third!.id);
    expect(service.replacePlanDayRecipe(userId, "2026-09-21", "2026-09-21", plan.updatedAt, second!.id).status)
      .toBe("invalid_recipe");
    const replaced = service.replacePlanDayRecipe(userId, "2026-09-21", "2026-09-21", plan.updatedAt, third!.id);
    expect(replaced.status).toBe("updated");
    expect(store.getWeeklyPlan(userId, "2026-09-21")?.days[0]?.mainRecipe.id).toBe(third!.id);
    expect(service.replacePlanDayRecipe(userId, "2026-09-21", "2026-09-21", plan.updatedAt, first!.id).status)
      .toBe("conflict");
  });
});
