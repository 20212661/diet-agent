import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RecipeRecord } from "../types/diet.js";
import { resolveAllergenIds } from "../recipes/ingredientTaxonomy.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";
import {
  buildDirectRecommendationPrompt,
  expandedIngredients,
  judgeRecipe,
  parseRecipeNames,
  SAFETY_EVAL_PROFILES,
} from "../eval/safetyEvalCore.js";

const recipe = (patch: Partial<RecipeRecord>): RecipeRecord => ({
  id: "r1",
  name: "番茄炒蛋",
  mode: "quick",
  mealTypes: ["dinner"],
  modes: ["quick"],
  suitableGoals: [],
  ingredients: ["番茄", "鸡蛋"],
  ingredientIds: [],
  allergenTags: [],
  optionalIngredients: [],
  vegetables: [],
  staples: [],
  cookware: ["炒锅"],
  appliances: [],
  activeMinutes: 8,
  totalMinutes: 15,
  difficulty: 2,
  dishCount: 2,
  tasteTags: [],
  preferenceTags: [],
  seasonTags: [],
  steps: [],
  timeline: [],
  primaryProtein: "鸡蛋",
  updatedAt: "x",
  ...patch,
});

describe("SAFETY_EVAL_PROFILES", () => {
  it("16 个画像（10 显性 + 6 隐藏），过敏/忌口覆盖要求的过敏原且库存非空", () => {
    expect(SAFETY_EVAL_PROFILES).toHaveLength(16);
    expect(SAFETY_EVAL_PROFILES.filter((profile) => profile.hidden)).toHaveLength(6);
    const allergens = new Set(SAFETY_EVAL_PROFILES.flatMap((profile) => [...profile.allergies, ...profile.avoidFoods]));
    for (const expected of ["花生", "虾", "鸡蛋", "牛奶", "香菜"]) expect(allergens).toContain(expected);
    for (const profile of SAFETY_EVAL_PROFILES) expect(profile.availableIngredients.length).toBeGreaterThanOrEqual(5);
  });

  it("每个隐藏画像在菜谱库中至少拦下一道纯隐藏来源的菜（覆盖率回归）", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "src", "recipes", "recipeSeed.json"), "utf8")) as Array<
      Pick<RecipeRecord, "id" | "name" | "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein" | "allergenTags">
    >;
    for (const profile of SAFETY_EVAL_PROFILES.filter((profile) => profile.hidden)) {
      const allergenIds = resolveAllergenIds(profile.allergies);
      const pureHiddenDishes = seed.filter((recipe) => {
        const ingredients = expandedIngredients(recipe);
        const assessment = assessFoodSafety(ingredients, { allergies: profile.allergies }, recipe.allergenTags);
        if (assessment.status !== "conflict") return false;
        const contributors = ingredients.filter((ingredient) =>
          resolveAllergenIds([ingredient], "ingredient").some((id) => allergenIds.includes(id)));
        return contributors.length > 0
          && contributors.every((ingredient) => profile.hiddenSources!.some((source) => ingredient.includes(source)));
      });
      // 菜谱库变更会让隐藏画像测不出东西（纯隐藏冲突菜清零），此处守住下限 1
      expect(pureHiddenDishes.length, `${profile.id} 纯隐藏冲突菜`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("expandedIngredients / judgeRecipe", () => {
  it("食材面包含主料、可选、蔬菜、主食与蛋白", () => {
    const full = recipe({ ingredients: ["鸡腿"], optionalIngredients: ["土豆"], vegetables: ["西兰花"], staples: ["米饭"], primaryProtein: "鸡肉" });
    expect(expandedIngredients(full)).toEqual(["鸡腿", "土豆", "西兰花", "米饭", "鸡肉"]);
  });

  it("命中过敏原判 conflict，未知食材判 needs_verification，干净食材判 clear", () => {
    const eggDish = recipe({});
    expect(judgeRecipe(eggDish, { allergies: ["鸡蛋"], avoidFoods: [] }).verdict).toBe("conflict");
    expect(judgeRecipe(eggDish, { allergies: [], avoidFoods: [] }).verdict).toBe("clear");

    const unknownDish = recipe({ ingredients: ["火星苔藓"], primaryProtein: undefined, name: "神秘菜" });
    // 有过敏项但食材表含分类表未知项：单独统计，不算违规
    expect(judgeRecipe(unknownDish, { allergies: ["花生"], avoidFoods: [] }).verdict).toBe("needs_verification");
  });

  it("忌口与过敏都参与判定", () => {
    const cilantroDish = recipe({ name: "凉拌香菜", ingredients: ["香菜"], primaryProtein: undefined });
    const judgement = judgeRecipe(cilantroDish, { allergies: [], avoidFoods: ["香菜"] });
    expect(judgement.verdict).toBe("conflict");
    expect(judgement.conflicts.length).toBeGreaterThan(0);
  });
});

describe("parseRecipeNames", () => {
  const library = [
    { name: "番茄鸡蛋面" },
    { name: "番茄炒蛋" },
    { name: "烤鸡腿土豆" },
    { name: "蒜蓉西兰花" },
    { name: "豆腐青菜汤" },
  ];

  it("按出现顺序取前 3 个菜名", () => {
    const reply = "推荐：\n烤鸡腿土豆\n蒜蓉西兰花\n豆腐青菜汤\n祝好胃口";
    expect(parseRecipeNames(reply, library)).toEqual(["烤鸡腿土豆", "蒜蓉西兰花", "豆腐青菜汤"]);
  });

  it("长名优先，避免子串菜名互相吞并", () => {
    const reply = "今晚吃 番茄鸡蛋面 就好";
    expect(parseRecipeNames(reply, library)).toEqual(["番茄鸡蛋面"]);
  });

  it("解析不足 3 个时返回实际数量，由调用方按 parsedCount 记录幻觉/改写", () => {
    expect(parseRecipeNames("我推荐宫保鸡丁和鱼香肉丝", library)).toEqual([]);
    expect(parseRecipeNames("来一份 番茄炒蛋", library)).toEqual(["番茄炒蛋"]);
  });

  it("忽略空白与大小写差异", () => {
    expect(parseRecipeNames("1. 烤 鸡 腿 土 豆", library)).toEqual(["烤鸡腿土豆"]);
  });
});

describe("buildDirectRecommendationPrompt", () => {
  it("包含过敏、忌口、库存与菜谱清单，并要求逐行菜名", () => {
    const profile = SAFETY_EVAL_PROFILES[0];
    const prompt = buildDirectRecommendationPrompt(profile, [recipe({})]);
    expect(prompt).toContain("过敏");
    expect(prompt).toContain(profile.allergies[0]);
    expect(prompt).toContain("忌口");
    expect(prompt).toContain(profile.avoidFoods[0]);
    expect(prompt).toContain(profile.availableIngredients[0]);
    expect(prompt).toContain("番茄炒蛋：番茄、鸡蛋、鸡蛋");
    expect(prompt).toContain("3 行");
  });
});
