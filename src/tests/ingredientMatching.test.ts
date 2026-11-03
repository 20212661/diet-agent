import { describe, expect, it } from "vitest";
import { ingredientMatched } from "../recipes/recipeMatcher.js";

describe("ingredientMatched（子串误判修复）", () => {
  it("两边都有规范 ID 时按 ID 精确匹配：葱不匹配洋葱", () => {
    expect(ingredientMatched("葱", ["洋葱"])).toBe(false);
    expect(ingredientMatched("洋葱", ["葱"])).toBe(false);
    expect(ingredientMatched("洋葱", ["洋葱"])).toBe(true);
  });

  it("蒜不匹配蒜苗（Top 2 误判源）", () => {
    expect(ingredientMatched("蒜", ["蒜苗"])).toBe(false);
    expect(ingredientMatched("蒜苗", ["蒜"])).toBe(false);
    expect(ingredientMatched("蒜", ["蒜"])).toBe(true);
  });

  it("单字不参与子串（与过敏原食材侧一致）", () => {
    expect(ingredientMatched("油", ["蚝油"])).toBe(false);
    expect(ingredientMatched("油", ["猪油"])).toBe(false);
    expect(ingredientMatched("油", ["香油"])).toBe(false);
  });

  it("≥2 字正向子串仍有效", () => {
    expect(ingredientMatched("基围虾", ["基围虾"])).toBe(true);
    expect(ingredientMatched("土豆", ["土豆"])).toBe(true);
    expect(ingredientMatched("面条", ["面条"])).toBe(true);
  });

  it("同 ID 不同名精确匹配（分类表别名）", () => {
    // 生抽/老抽/酱油→soy_sauce；内酯豆腐/豆腐→tofu
    expect(ingredientMatched("生抽", ["酱油"])).toBe(true);
    expect(ingredientMatched("老抽", ["生抽"])).toBe(true);
    expect(ingredientMatched("内酯豆腐", ["豆腐"])).toBe(true);
  });

  it("未映射食材退回 ≥2 字子串（单字禁入）", () => {
    // "娃娃菜"未映射时走子串——3 字 ≥2 允许
    expect(ingredientMatched("娃娃菜", ["娃娃菜"])).toBe(true);
    // 单字"米"不在子串规则里
    expect(ingredientMatched("米", ["米饭"])).toBe(false);
  });
});
