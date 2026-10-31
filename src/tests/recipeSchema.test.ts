import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveRecipeIngredientMetadata,
  normalizeIngredientId,
  resolveAllergenIds,
} from "../recipes/ingredientTaxonomy.js";
import { validateRecipeSeed } from "../recipes/recipeSchema.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";

const seed = JSON.parse(readFileSync(join(process.cwd(), "src", "recipes", "recipeSeed.json"), "utf8"));

describe("菜谱 Schema 与过敏原元数据", () => {
  it("完整种子数据通过所有构建校验", () => {
    expect(validateRecipeSeed(seed)).toEqual([]);
  });

  it("识别重复 ID、非法枚举和电器步骤不一致", () => {
    const duplicate = structuredClone(seed[0]);
    duplicate.mode = "invalid";
    duplicate.appliances = ["microwave"];
    duplicate.steps = ["切好后装盘。"];
    const errors = validateRecipeSeed([seed[0], duplicate]);
    expect(errors.some((error) => error.includes("duplicate recipe id"))).toBe(true);
    expect(errors.some((error) => error.includes("appliance microwave"))).toBe(true);
    expect(errors.some((error) => error.includes("must match a schema"))).toBe(true);
  });

  it("标签缺失或陈旧时校验失败", () => {
    const recipe = structuredClone(seed.find((item: any) => item.ingredients.includes("花生")));
    recipe.allergenTags = [];
    expect(validateRecipeSeed([recipe]).some((error) => error.includes("allergenTags"))).toBe(true);
  });

  it("过敏原别名映射到统一 ID", () => {
    expect(resolveAllergenIds(["花生油", "花生酱", "花生碎"])).toEqual(["peanut"]);
    expect(resolveAllergenIds(["奶酪", "芝士片"])).toEqual(["milk"]);
    expect(normalizeIngredientId("西红柿")).toBe("tomato");
    expect(deriveRecipeIngredientMetadata(["鸡蛋", "牛奶", "吐司"]).allergenTags)
      .toEqual(["egg", "gluten", "milk", "wheat"]);
  });

  it("食材侧禁止反向子串：葱不是小麦、糖不是牛奶、鱼不是甲壳类", () => {
    // 曾因 alias.includes(normalized) 误报："冷冻葱油饼"包含"葱"、"乳糖"包含"糖"、"鱿鱼"包含"鱼"
    expect(resolveAllergenIds(["葱", "大葱", "葱花"], "ingredient")).toEqual([]);
    expect(resolveAllergenIds(["糖", "白糖", "红糖"], "ingredient")).toEqual([]);
    expect(resolveAllergenIds(["鱼"], "ingredient")).toEqual(["fish"]);
    // 数据驱动补的精确别名：旧规则靠"鱼"子串命中的真实鱼类不回退
    expect(resolveAllergenIds(["金枪鱼", "鱼肉"], "ingredient")).toEqual(["fish"]);
  });

  it("食材侧正向命中不受影响：黄油仍是牛奶、虾仁仍是甲壳类、花生酱仍是花生", () => {
    expect(resolveAllergenIds(["黄油", "奶油"], "ingredient")).toEqual(["milk"]);
    expect(resolveAllergenIds(["虾仁", "虾皮", "基围虾"], "ingredient")).toEqual(["shellfish"]);
    expect(resolveAllergenIds(["花生酱"], "ingredient")).toEqual(["peanut"]);
    expect(resolveAllergenIds(["蚝油", "酱油"], "ingredient")).toEqual(
      expect.arrayContaining(["shellfish"]),
    );
    expect(resolveAllergenIds(["酱油"], "ingredient")).toEqual(expect.arrayContaining(["soy", "wheat"]));
    // 单字别名只精确匹配，不参与子串（"蛋"精确命中，"蛋白粉"走自己的定义）
    expect(resolveAllergenIds(["蛋", "蛋清", "蛋黄"], "ingredient")).toEqual(["egg"]);
  });

  it("用户侧保持宽松匹配：写'虾'能命中虾仁、写'奶'能命中牛奶", () => {
    expect(resolveAllergenIds(["虾"])).toContain("shellfish");
    expect(resolveAllergenIds(["奶"])).toContain("milk");
    expect(resolveAllergenIds(["麸质"])).toEqual(expect.arrayContaining(["gluten", "wheat"]));
  });

  it("番茄炒蛋对牛奶过敏用户是安全的（评测误报回归）", () => {
    // C 组评测曾把"糖 (milk)"判为违规，实为反向子串误报
    const assessment = assessFoodSafety(["番茄", "鸡蛋", "糖"], { allergies: ["牛奶"] });
    expect(assessment.status).toBe("clear");
    expect(assessFoodSafety(["黄油", "面包"], { allergies: ["牛奶"] }).status).toBe("conflict");
    expect(assessFoodSafety(["葱", "猪肉"], { allergies: ["小麦"] }).status).toBe("clear");
  });

  it("共享安全判定识别过敏原别名与复合调味料，并将未知项设为待核实", () => {
    expect(assessFoodSafety(["虾仁"], { allergies: ["甲壳类"] }).status).toBe("conflict");
    expect(assessFoodSafety(["蚝油"], { allergies: ["shellfish"] }).status).toBe("conflict");
    expect(assessFoodSafety(["豆瓣酱"], { allergies: ["小麦"] }).status).toBe("conflict");
    expect(assessFoodSafety(["火锅底料"], { allergies: ["花生"] }).status).toBe("needs_verification");
    expect(assessFoodSafety(["未知食材"], { avoidFoods: ["辣椒"] })).toMatchObject({
      status: "needs_verification",
      unknownIngredients: ["未知食材"],
    });
    expect(assessFoodSafety(["鸡胸肉"], { allergies: ["花生"] }).status).toBe("clear");
  });

  it("从主蛋白、蔬菜和主食字段推导过敏原", () => {
    const completeSeed = structuredClone(seed);
    const recipe = structuredClone(seed[0]);
    recipe.primaryProtein = "花生酱";
    recipe.vegetables = ["虾仁"];
    recipe.staples = ["吐司"];
    Object.assign(recipe, deriveRecipeIngredientMetadata([
      ...recipe.ingredients,
      ...recipe.optionalIngredients,
      recipe.primaryProtein,
      ...recipe.vegetables,
      ...recipe.staples,
    ]));
    completeSeed[0] = recipe;
    expect(validateRecipeSeed(completeSeed)).toEqual([]);
    expect(recipe.allergenTags).toEqual(["gluten", "peanut", "shellfish", "wheat"]);

    recipe.allergenTags = ["peanut"];
    expect(validateRecipeSeed([recipe]).some((error) => error.includes("allergenTags"))).toBe(true);
  });
});
