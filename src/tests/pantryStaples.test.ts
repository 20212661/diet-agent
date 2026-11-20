/**
 * 常备调料（修复 B）：缺料计算视为"已有"；
 * 过敏判定不受影响（常备的生抽仍然让小麦过敏用户被拦截）。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PANTRY_STAPLES } from "../recipes/ingredientTaxonomy.js";
import { matchRecipesDetailed } from "../recipes/recipeMatcher.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";
import type { KitchenProfile, RecipeRecord } from "../types/diet.js";

const kitchen = (overrides: Partial<KitchenProfile> = {}): KitchenProfile => ({
  userId: "t", burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true,
  cookware: ["炒锅", "汤锅"], maxActiveMinutes: 60, maxTotalMinutes: 90,
  tastePreferences: [], cookingPreferences: [], updatedAt: "",
  ...overrides,
});

const recipe = (overrides: Partial<RecipeRecord> = {}): RecipeRecord => ({
  id: "r_p", name: "葱烧豆腐", mode: "quick", ingredients: ["豆腐", "大葱", "生抽"],
  mealTypes: ["dinner"], modes: [], suitableGoals: [], optionalIngredients: [],
  vegetables: [], staples: [], cookware: ["炒锅"], appliances: ["stove"],
  activeMinutes: 10, totalMinutes: 20, difficulty: 2, dishCount: 2, steps: [],
  tasteTags: [], updatedAt: "",
  ...overrides,
} as RecipeRecord);

describe("常备调料与缺料计算", () => {
  it("库存只有豆腐时，大葱/生抽不再计入 missing（常备视为已有）", () => {
    const outcome = matchRecipesDetailed({
      recipes: [recipe()], availableIngredients: [{ name: "豆腐", status: "available" }],
      shoppingList: [], kitchenProfile: kitchen(), feedback: [],
      pantryStaples: DEFAULT_PANTRY_STAPLES,
    });
    expect(outcome.matches[0]!.missingIngredients).toEqual([]);
  });

  it("自定义常备调料（清空后大葱重新算缺失）", () => {
    const outcome = matchRecipesDetailed({
      recipes: [recipe()], availableIngredients: [{ name: "豆腐", status: "available" }],
      shoppingList: [], kitchenProfile: kitchen(), feedback: [],
      pantryStaples: [], // 清空常备
    });
    expect(outcome.matches[0]!.missingIngredients).toContain("大葱");
    expect(outcome.matches[0]!.missingIngredients).toContain("生抽");
  });

  it("过敏判定不受常备调料影响：小麦过敏用户仍被生抽拦截", () => {
    // assessFoodSafety 看菜谱自身食材面，不看库存/常备
    const verdict = assessFoodSafety(["豆腐", "大葱", "生抽"], { allergies: ["小麦"] });
    expect(verdict.status).toBe("conflict");
    // 匹配器同样：小麦过敏画像下这道菜被安全过滤（不是因为缺料）
    const outcome = matchRecipesDetailed({
      recipes: [recipe()], availableIngredients: [{ name: "豆腐", status: "available" }],
      shoppingList: [], kitchenProfile: kitchen(),
      userProfile: { userId: "t", allergies: ["小麦"], createdAt: "", updatedAt: "" },
      feedback: [],
    });
    expect(outcome.matches).toHaveLength(0); // 被安全过滤，不是缺料
  });

  it("shop_group 门：必需食材全部齐全才进 matches，否则进 needsShopping", () => {
    const outcome = matchRecipesDetailed({
      recipes: [recipe({ ingredients: ["豆腐", "大葱", "生抽", "五花肉"] })],
      availableIngredients: [{ name: "豆腐", status: "available" }],
      shoppingList: [], kitchenProfile: kitchen(), feedback: [],
      missingPrimaryProteinPolicy: "shop_group",
      pantryStaples: DEFAULT_PANTRY_STAPLES,
    });
    // 豆腐+常备齐全但五花肉缺 → needsShopping
    expect(outcome.needsShopping).toHaveLength(1);
    expect(outcome.needsShopping[0]!.recipe.name).toBe("葱烧豆腐");
    expect(outcome.needsShopping[0]!.missingIngredients).toEqual(["五花肉"]);
    expect(outcome.matches).toHaveLength(0);
  });
});

describe("主蛋白推断修复", () => {
  it("排骨炖土豆：字段'猪肉'不在食材里 → 推断出'排骨'", async () => {
    const { resolvePrimaryProtein } = await import("../recipes/proteinInference.js");
    const result = resolvePrimaryProtein({ primaryProtein: "猪肉", ingredients: ["排骨", "土豆"] });
    expect(result).toEqual({ value: "排骨", source: "inferred" });
  });

  it("字段 ID 在食材里 → 保留 field 来源", async () => {
    const { resolvePrimaryProtein } = await import("../recipes/proteinInference.js");
    const result = resolvePrimaryProtein({ primaryProtein: "五花肉", ingredients: ["五花肉", "蒜苗"] });
    expect(result).toEqual({ value: "五花肉", source: "field" });
  });
});
