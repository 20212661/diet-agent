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

  it("盲标比对发现的漏标：咖喱块是小麦/麸质来源，牛奶品牌非必含不标", () => {
    // 20 道菜盲标比对中咖喱鸡块的 wheat/gluten 漏标，根因是咖喱块在 UNRESOLVED 列表
    expect(resolveAllergenIds(["咖喱块"], "ingredient")).toEqual(["gluten", "wheat"]);
    expect(normalizeIngredientId("咖喱块")).toBe("curry_roux");
    // 咖喱块常含乳成分但非必含（人工标注放入 unsure）：不得顺手标 milk
    expect(resolveAllergenIds(["咖喱块"], "ingredient")).not.toContain("milk");
  });

  it("隐藏过敏原别名：加工食材带出过敏原，不确定的不猜", () => {
    // 面包糠/面包屑/面包/吐司 → 小麦+麸质；蛋、奶按品牌差异大，不标
    expect(resolveAllergenIds(["面包糠", "面包屑", "面包", "吐司"], "ingredient")).toEqual(["gluten", "wheat"]);
    // 芝麻酱 → 芝麻（原靠"芝麻"子串间接命中，补显式别名）
    expect(resolveAllergenIds(["芝麻酱"], "ingredient")).toEqual(["sesame"]);
    // 沙拉酱/蛋黄酱 → 鸡蛋；花生酱 → 花生
    expect(resolveAllergenIds(["沙拉酱", "蛋黄酱"], "ingredient")).toEqual(["egg"]);
    expect(resolveAllergenIds(["花生酱"], "ingredient")).toEqual(["peanut"]);
    // 奶油/黄油/芝士 → 牛奶
    expect(resolveAllergenIds(["奶油", "黄油", "芝士"], "ingredient")).toEqual(["milk"]);
    // 生抽/老抽/酱油 → 大豆+小麦；蚝油 → 甲壳类（常见市售配方同时含大豆/小麦）
    expect(resolveAllergenIds(["生抽", "老抽", "酱油"], "ingredient")).toEqual(["gluten", "soy", "wheat"]);
    expect(resolveAllergenIds(["蚝油"], "ingredient")).toEqual(["gluten", "shellfish", "soy", "wheat"]);
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

  it("忌口不展开成过敏原类别，只按食材名文本匹配", () => {
    // 忌口"葱"：不再经反向子串屏蔽小麦菜，但含葱的菜仍被拦
    expect(assessFoodSafety(["面条", "面粉"], { avoidFoods: ["葱"] }).status).toBe("clear");
    expect(assessFoodSafety(["葱", "猪肉"], { avoidFoods: ["葱"] }).status).toBe("conflict");
    // 忌口"糖"（控糖）：不再误屏蔽牛奶；忌口"油"：不再几乎过滤整个菜谱库
    expect(assessFoodSafety(["牛奶", "奶油"], { avoidFoods: ["糖"] }).status).toBe("clear");
    expect(assessFoodSafety(["花生", "面条", "虾"], { avoidFoods: ["油"] }).status).toBe("clear");
    expect(assessFoodSafety(["橄榄油", "青菜"], { avoidFoods: ["油"] }).status).toBe("conflict");
    // 忌口"蛋"：不再连带屏蔽牛奶/大豆，但含蛋的菜被拦
    expect(assessFoodSafety(["牛奶", "豆腐"], { avoidFoods: ["蛋"] }).status).toBe("clear");
    expect(assessFoodSafety(["鸡蛋", "番茄"], { avoidFoods: ["蛋"] }).status).toBe("conflict");
  });

  it("过敏仍然宽松展开：写'奶'命中黄油，写'虾'命中虾仁", () => {
    expect(assessFoodSafety(["黄油", "面包"], { allergies: ["奶"] }).status).toBe("conflict");
    expect(assessFoodSafety(["虾仁", "西芹"], { allergies: ["虾"] }).status).toBe("conflict");
    // 同一用户：忌口"糖"不拦牛奶，但过敏"奶"仍然拦
    expect(assessFoodSafety(["牛奶"], { avoidFoods: ["糖"], allergies: ["奶"] }).status).toBe("conflict");
  });

  it("忌口类别词精确相等时按词表展开（海鲜/乳制品/豆制品/坚果/面食）", () => {
    // "海鲜"在食材名里不会出现，纯文本匹配拦不住——修复前"不吃海鲜"的用户会被推荐虾仁
    expect(assessFoodSafety(["虾仁", "鸡蛋"], { avoidFoods: ["海鲜"] }).status).toBe("conflict");
    expect(assessFoodSafety(["带鱼", "姜"], { avoidFoods: ["海鲜"] }).status).toBe("conflict");
    expect(assessFoodSafety(["鸡肉", "青菜"], { avoidFoods: ["海鲜"] }).status).toBe("clear");
    expect(assessFoodSafety(["黄油", "面包"], { avoidFoods: ["乳制品"] }).status).toBe("conflict");
    expect(assessFoodSafety(["豆腐", "青菜"], { avoidFoods: ["豆制品"] }).status).toBe("conflict");
    expect(assessFoodSafety(["核桃"], { avoidFoods: ["坚果"] }).status).toBe("conflict");
    expect(assessFoodSafety(["花生酱"], { avoidFoods: ["坚果"] }).status).toBe("conflict");
    expect(assessFoodSafety(["面条"], { avoidFoods: ["面食"] }).status).toBe("conflict");
  });

  it("非类别词忌口不回退到类别展开（PR #7 防回归）", () => {
    expect(assessFoodSafety(["面条", "面粉"], { avoidFoods: ["葱"] }).status).toBe("clear");
    expect(assessFoodSafety(["牛奶"], { avoidFoods: ["糖"] }).status).toBe("clear");
    // 已知取舍（仅影响口味偏好，不涉安全，暂不处理）：
    // 单字忌口正向子串会命中"洋葱"（葱⊂洋葱，语义上是两种菜）；
    expect(assessFoodSafety(["洋葱", "猪肉"], { avoidFoods: ["葱"] }).status).toBe("conflict");
    // 忌口"油"命中酱油/蚝油/香油——符合字面意思，视为可接受。
    expect(assessFoodSafety(["酱油", "青菜"], { avoidFoods: ["油"] }).status).toBe("conflict");
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
