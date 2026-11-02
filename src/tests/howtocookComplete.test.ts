import { describe, expect, it } from "vitest";
import { crossCheck, type CompletedFields } from "../import/howtocook/completeFields.js";
import { dedupeCheck, htcRecipeId, normalizeRecipeName } from "../import/howtocook/dedupe.js";
import type { HtcRawRecipe } from "../import/howtocook/types.js";

const fields = (overrides: Partial<CompletedFields> = {}): CompletedFields => ({
  mode: "stovetop", modes: ["stovetop"], mealTypes: ["dinner"], suitableGoals: ["balanced"],
  activeMinutes: 15, totalMinutes: 30, appliances: ["stove"], cookware: ["炒锅"], dishCount: 1,
  tasteTags: [], preferenceTags: [], vegetables: [], staples: [],
  ...overrides,
});

const rawRecipe = (overrides: Partial<HtcRawRecipe> = {}): HtcRawRecipe => ({
  name: "测试菜", category: "meat_dish", difficulty: 2,
  requiredItems: ["鸡肉"], optionalItems: [], utensils: [], computeLines: [],
  steps: ["热锅下油", "炒 5 分钟"], chosenVariant: undefined, variantCount: 1, stepMinutesTotal: 5,
  source: { repo: "x", commit: "c", path: "dishes/x.md" },
  ...overrides,
});

describe("crossCheck（P3 交叉检查）", () => {
  it("步骤提到烤箱/微波炉/电饭煲但 appliances 未声明 → 报问题", () => {
    const recipe = rawRecipe({ steps: ["放入烤箱烤 20 分钟"] });
    const problems = crossCheck(recipe, fields({ appliances: ["stove"] }));
    expect(problems.some((p) => p.includes("烤箱"))).toBe(true);
  });

  it("activeMinutes > totalMinutes 被拦截（sanitize 后双保险）", () => {
    expect(crossCheck(rawRecipe(), fields({ activeMinutes: 40, totalMinutes: 30 }))).toContain("activeMinutes > totalMinutes");
  });

  it("耗时不一致：totalMinutes 偏离步骤分钟合计超出 [-20,+45] 容差", () => {
    const recipe = rawRecipe({ stepMinutesTotal: 210 });
    expect(crossCheck(recipe, fields({ totalMinutes: 240 })).join()).toContain("与步骤分钟合计 210 不一致");
    // 容差内不报：210-10=200 ✓，210+45=255 ✓
    expect(crossCheck(recipe, fields({ totalMinutes: 200 }))).toEqual([]);
    expect(crossCheck(recipe, fields({ totalMinutes: 255 }))).toEqual([]);
  });

  it("步骤没提取到分钟数时跳过耗时一致性检查", () => {
    expect(crossCheck(rawRecipe({ stepMinutesTotal: undefined }), fields({ totalMinutes: 240 }))).toEqual([]);
  });
});

describe("dedupe（P3 去重）", () => {
  it("菜名规范化剥装饰词：家常/简易/的做法", () => {
    expect(normalizeRecipeName("家常番茄炒蛋")).toBe("番茄炒蛋");
    expect(normalizeRecipeName("简易蛋炒饭的做法")).toBe("蛋炒饭");
    expect(normalizeRecipeName("宫保鸡丁（可选莴笋版）")).toBe("宫保鸡丁");
  });

  it("ID 幂等：同一路径恒同 ID、不同路径不同 ID", () => {
    expect(htcRecipeId("dishes/a/b.md")).toBe(htcRecipeId("dishes/a/b.md"));
    expect(htcRecipeId("dishes/a/b.md")).not.toBe(htcRecipeId("dishes/a/c.md"));
    expect(htcRecipeId("dishes/a/b.md")).toMatch(/^htc_[a-z0-9_]+$/);
  });

  it("同名判重与 Jaccard 疑似重复（≥0.7），种子优先保留变体", () => {
    const existing = [{ name: "番茄炒蛋", ingredients: ["番茄", "鸡蛋", "糖"], optionalIngredients: [], vegetables: [], staples: [] }];
    const sameName = rawRecipe({ name: "家常番茄炒蛋", requiredItems: ["番茄", "鸡蛋", "盐"] });
    const outcome = dedupeCheck(sameName, existing);
    expect(outcome.nameDuplicateOf).toBe("番茄炒蛋");
    expect(outcome.suspectedDuplicates).toContain("番茄炒蛋"); // 食材高度重合

    const different = rawRecipe({ name: "清蒸鲈鱼", requiredItems: ["鲈鱼", "姜", "葱"] });
    const outcome2 = dedupeCheck(different, existing);
    expect(outcome2.nameDuplicateOf).toBeUndefined();
    expect(outcome2.suspectedDuplicates).toEqual([]);
  });
});
