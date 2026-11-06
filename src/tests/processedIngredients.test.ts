/**
 * 加工品独立条目 + 别名后缀护栏（2026-11-06 人工确认口径）：
 * - 新条目解析与匹配侧拆分（库存 X ≠ X 酱/X 油/X 粉）
 * - 护栏不误伤既有合理匹配（（可选）/带注/同条目别名/连写含词）
 * - 安全断言按确认口径（蛋黄酱 soy 不标、海鲜酱不标 shellfish/fish 等）
 * - P2 批准规则回归（鸡精两断言 + 料酒/醋/啤酒/十三香/五香粉/豆芽/青豆/田螺）
 */
import { describe, expect, it } from "vitest";
import { normalizeIngredientId, resolveAllergenIds, resolvePossibleAllergenIds } from "../recipes/ingredientTaxonomy.js";
import { ingredientMatched } from "../recipes/recipeMatcher.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";

describe("加工品独立条目（匹配侧拆分）", () => {
  it("词形解析到独立 ID，不再劫持原料 ID", () => {
    expect(normalizeIngredientId("番茄酱")).toBe("tomato_paste");
    expect(normalizeIngredientId("桂林辣椒酱")).toBe("guilin_chili_sauce");
    expect(normalizeIngredientId("辣椒油")).toBe("chili_oil"); // 与既有条目（油泼辣子，possible sesame）合并
    expect(normalizeIngredientId("花生油")).toBe("peanut_oil");
    expect(normalizeIngredientId("花生酱")).toBe("peanut_butter");
    expect(normalizeIngredientId("芝麻香油")).toBe("sesame_oil");
    expect(normalizeIngredientId("土豆淀粉")).toBe("potato_starch");
    expect(normalizeIngredientId("蛋黄酱")).toBe("mayonnaise");
    expect(normalizeIngredientId("沙茶酱")).toBe("satay_sauce");
  });

  it("库存原料 ≠ 加工品：跨形态误判修复", () => {
    expect(ingredientMatched("番茄酱", ["番茄"])).toBe(false);
    expect(ingredientMatched("辣椒油", ["辣椒"])).toBe(false);
    expect(ingredientMatched("花生酱", ["花生"])).toBe(false);
    expect(ingredientMatched("蛋黄酱", ["鸡蛋"])).toBe(false);
    expect(ingredientMatched("土豆淀粉", ["土豆"])).toBe(false);
    expect(ingredientMatched("蒜蓉酱", ["蒜"])).toBe(false);
  });

  it("护栏不误伤既有合理匹配", () => {
    expect(ingredientMatched("鸡蛋（可选）", ["鸡蛋"])).toBe(true);
    expect(ingredientMatched("鸡腿肉", ["鸡腿"])).toBe(true);
    expect(ingredientMatched("葱", ["小葱"])).toBe(true);
    expect(ingredientMatched("花生碎", ["花生"])).toBe(true); // 花生碎=花生本体，未拆
    expect(ingredientMatched("面", ["面条"])).toBe(true);
    expect(ingredientMatched("生抽", ["酱油"])).toBe(true); // 同条目别名
    expect(ingredientMatched("红薯淀粉", ["淀粉"])).toBe(true); // 淀粉族同条目
    expect(ingredientMatched("蒜粉", ["蒜"])).toBe(true); // 粉状同物并入本体
    expect(ingredientMatched("小麦粉", ["面粉"])).toBe(true);
  });
});

describe("加工品过敏原（2026-11-06 人工确认口径）", () => {
  const status = (ingredient: string, allergy: string) =>
    assessFoodSafety([ingredient], { allergies: [allergy] }).status;

  it("沙茶酱：shellfish/fish/peanut 确定，sesame 可能", () => {
    expect(status("沙茶酱", "虾")).toBe("conflict");
    expect(status("沙茶酱", "鱼")).toBe("conflict");
    expect(status("沙茶酱", "花生")).toBe("conflict");
    expect(status("沙茶酱", "芝麻")).toBe("needs_verification");
  });

  it("海鲜酱（hoisin）：soy/wheat 确定、sesame 可能；不标 shellfish/fish", () => {
    expect(status("海鲜酱", "大豆")).toBe("conflict");
    expect(status("海鲜酱", "小麦")).toBe("conflict");
    expect(status("海鲜酱", "芝麻")).toBe("needs_verification");
    expect(status("海鲜酱", "虾")).toBe("clear");
    expect(status("海鲜酱", "鱼")).toBe("clear");
  });

  it("蛋黄酱 egg 确定、soy 不标（与食用油规则一致）；香辣酱可能含 soy/wheat/peanut", () => {
    expect(status("蛋黄酱", "鸡蛋")).toBe("conflict");
    expect(status("蛋黄酱", "大豆")).toBe("clear");
    expect(status("香辣酱", "花生")).toBe("needs_verification");
    expect(status("香辣酱", "小麦")).toBe("needs_verification");
    expect(resolveAllergenIds(["香辣酱"], "ingredient")).toEqual([]); // 确定级为空
  });

  it("其余确认口径：牛肉酱 soy/wheat 确定；蒜蓉酱可能含 soy；番茄酱不标；花生制品继续标 peanut", () => {
    expect(status("牛肉酱", "大豆")).toBe("conflict");
    expect(status("蒜蓉酱", "大豆")).toBe("needs_verification");
    expect(status("番茄酱", "大豆")).toBe("clear");
    expect(status("番茄酱", "小麦")).toBe("clear");
    expect(status("花生油", "花生")).toBe("conflict");
    expect(status("芝麻酱", "芝麻")).toBe("conflict");
  });
});

describe("P2 批准规则回归（护栏与拆分不得破坏既有条目）", () => {
  it("鸡精：小麦 conflict / 鸡蛋 needs_verification（wheat/gluten 确定 + egg 可能含）", () => {
    expect(normalizeIngredientId("鸡精")).toBe("chicken_essence");
    expect(assessFoodSafety(["鸡精"], { allergies: ["小麦"] }).status).toBe("conflict");
    expect(assessFoodSafety(["鸡精"], { allergies: ["鸡蛋"] }).status).toBe("needs_verification");
  });

  it("其余 P2 条目逐项生效", () => {
    expect(normalizeIngredientId("料酒")).toBe("cooking_wine");
    expect(resolveAllergenIds(["料酒"], "ingredient")).toEqual(["gluten", "wheat"]);
    expect(resolvePossibleAllergenIds(["醋"], "ingredient")).toEqual(expect.arrayContaining(["gluten", "wheat"]));
    expect(resolveAllergenIds(["啤酒"], "ingredient")).toEqual(["gluten"]);
    expect(resolvePossibleAllergenIds(["十三香"], "ingredient")).toContain("wheat");
    expect(resolvePossibleAllergenIds(["五香粉"], "ingredient")).toContain("wheat");
    expect(resolvePossibleAllergenIds(["豆芽"], "ingredient")).toContain("soy");
    expect(resolvePossibleAllergenIds(["青豆"], "ingredient")).toContain("soy");
    expect(resolveAllergenIds(["田螺"], "ingredient")).toEqual(["shellfish"]);
  });
});
