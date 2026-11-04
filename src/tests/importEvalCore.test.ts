/**
 * P5 导入评测的确定性安全面（CI，不依赖 LLM）：
 *  - 检查器遗漏率：对 10 份场景文本，带过敏原的原文别名"要么被抽取、要么被标红"
 *    ——用完整抽取与残缺抽取两种 canned draft 夹逼验证（目标恒 0 漏报）。
 *  - 注入场景：期望食材齐备时注入防御成立。
 * 期望食材标注来源：LLM 标注（见 importScenarios.ts 头注），此处只测检查器责任。
 */
import { describe, expect, it } from "vitest";
import { IMPORT_SCENARIOS } from "../eval/importScenarios.js";
import { evaluateImportScenario } from "../eval/importEvalCore.js";
import { omissionCheck } from "../import/userRecipe/checks.js";
import { INGREDIENT_DEFINITIONS, normalizeIngredientId } from "../recipes/ingredientTaxonomy.js";
import type { UserRecipeDraft } from "../import/userRecipe/types.js";

function draftFromIngredients(name: string, ingredients: string[]): UserRecipeDraft {
  return {
    name,
    mealTypes: ["dinner"],
    modes: ["stovetop"],
    suitableGoals: ["balanced"],
    ingredients,
    optionalIngredients: [],
    vegetables: [],
    staples: [],
    cookware: [],
    appliances: ["stove"],
    activeMinutes: 15,
    totalMinutes: 25,
    difficulty: 2,
    dishCount: 1,
    tasteTags: [],
    preferenceTags: [],
    steps: ["示例步骤"],
  };
}

/** 场景文本里出现（未覆盖）且带过敏原的条目 id —— 检查器必须一个不漏地覆盖到。 */
function expectedAllergenSurface(text: string): Set<string> {
  const surface = new Set<string>();
  for (const definition of INGREDIENT_DEFINITIONS) {
    if ((definition.allergens?.length ?? 0) + (definition.possibleAllergens?.length ?? 0) === 0) continue;
    if (definition.aliases.some((alias) => alias && text.includes(alias))) surface.add(definition.id);
  }
  return surface;
}

describe("P5 导入评测：检查器安全面（确定性，CI）", () => {
  it("10 份场景文本都带有过敏原表面（评测集有效性前提）", () => {
    for (const scenario of IMPORT_SCENARIOS) {
      expect(expectedAllergenSurface(scenario.text).size, `${scenario.id} 应含过敏原别名`).toBeGreaterThan(0);
    }
  });

  it("完整抽取：检查器遗漏过敏原恒为 0；注入场景防御成立", () => {
    for (const scenario of IMPORT_SCENARIOS) {
      const draft = draftFromIngredients(scenario.style, [...scenario.expectedIngredients]);
      const result = evaluateImportScenario(scenario, draft);
      expect(result.checkerMissedAllergens, `${scenario.id} 检查器不应漏过敏原`).toEqual([]);
      // 完整抽取时召回率应为 1（同一口径的自洽性）
      expect(result.extractionRecall, `${scenario.id} 完整抽取应全中`).toBe(1);
      if (scenario.injection) {
        expect(result.injectionWithstood, `${scenario.id} 注入防御应成立`).toBe(true);
      }
    }
  });

  it("残缺抽取（抽掉全部过敏原食材）：每个被抽掉的过敏原条目都被遗漏检查标红", () => {
    for (const scenario of IMPORT_SCENARIOS) {
      const allergenIds = new Set(
        [...expectedAllergenSurface(scenario.text)].map((id) => id)
      );
      // 抽掉会命中过敏原条目的期望食材，其余保留
      const depleted = scenario.expectedIngredients.filter(
        (name) => !allergenIds.has(normalizeIngredientId(name))
      );
      const draft = draftFromIngredients(scenario.style, depleted);
      const findings = omissionCheck(draft, scenario.text);
      const flaggedIds = new Set(findings.map((f) => f.definitionId));
      const surface = expectedAllergenSurface(scenario.text);
      const dropped = [...surface].filter((id) => id === normalizeIngredientId(scenario.expectedIngredients.find((n) => normalizeIngredientId(n) === id) ?? ""));
      // 至少确保该场景确实抽掉了 ≥1 个过敏原食材（评测集有效性）
      const droppedAny = scenario.expectedIngredients.some((name) => surface.has(normalizeIngredientId(name)));
      if (!droppedAny) continue;
      for (const id of dropped) {
        expect(flaggedIds.has(id), `${scenario.id} 抽掉的过敏原食材 ${id} 应被标红`).toBe(true);
      }
      // 评测指标同样不漏
      const result = evaluateImportScenario(scenario, draft);
      expect(result.checkerMissedAllergens, `${scenario.id} 残缺抽取下检查器不应漏`).toEqual([]);
      expect(result.extractionOmissionRate, `${scenario.id} 残缺抽取应体现遗漏率>0`).toBeGreaterThan(0);
      if (scenario.injection) {
        // 注入场景的残缺抽取：防御断言应翻转为 false（过敏原食材没了）
        expect(result.injectionWithstood).toBe(false);
      }
    }
  });
});
