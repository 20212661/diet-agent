/**
 * P1 漏斗报告：解析成功率、工具分离效果、分类表覆盖率与未映射 Top N。
 * 覆盖率双口径：按出现次数（加权，反映实际影响面）与按写法种类。
 */
import { normalizeIngredientId } from "../../recipes/ingredientTaxonomy.js";
import { normalizeIngredientText } from "./normalize.js";
import type { HtcParseResult } from "./types.js";

/** 疑似过敏原线索词：命中即在报告中标记，交人工重点审核（P1 只标记不判定）。 */
const SUSPECT_ALLERGEN_WORDS: readonly string[] = [
  "酒", "酱", "豉", "麻油", "鸡精", "味精", "蚝油", "精", "膏", "奶", "酪",
  "蛋", "麦", "麸", "芝麻", "花生", "坚果", "鱼", "虾", "蟹", "贝", "鱿", "蚝",
  "大豆", "豆", "面", "粉", "醋",
];

export interface FunnelReport {
  source: { repo: string; commit: string; tarballSha256: string };
  totals: {
    files: number;
    parsed: number;
    failed: number;
    multiVersion: number;
    chosenVariantBreakdown: Record<string, number>;
    withoutCompute: number;
    withoutStepMinutes: number;
    difficultyBreakdown: Record<string, number>;
  };
  failures: Array<{ path: string; problems: string[] }>;
  utensils: {
    separatedCount: number;
    /** 漏网抽样：被当作食材但含明显器皿字样的写法 */
    missedSamples: Array<{ name: string; count: number }>;
  };
  coverage: {
    ingredientOccurrences: number;
    mappedOccurrences: number;
    coverageByOccurrence: number;
    distinctNames: number;
    mappedDistinctNames: number;
    coverageByVariant: number;
  };
  topUnmapped: Array<{ name: string; count: number; suspectAllergen: boolean }>;
}

export function buildFunnelReport(
  results: Array<{ path: string; result: HtcParseResult }>,
  source: { repo: string; commit: string; tarballSha256: string },
): FunnelReport {
  const failures: FunnelReport["failures"] = [];
  const occurrenceCounts = new Map<string, number>();
  let separatedUtensilCount = 0;
  const missedUtensilSamples = new Map<string, number>();
  const chosenVariantBreakdown: Record<string, number> = {};
  const difficultyBreakdown: Record<string, number> = {};
  let multiVersion = 0;
  let withoutCompute = 0;
  let withoutStepMinutes = 0;

  for (const { path, result } of results) {
    if (!result.recipe) {
      failures.push({ path, problems: result.problems });
      continue;
    }
    const recipe = result.recipe;
    if (recipe.variantCount > 1) {
      multiVersion += 1;
      const key = recipe.chosenVariant ?? "(第一个版本)";
      chosenVariantBreakdown[key] = (chosenVariantBreakdown[key] ?? 0) + 1;
    }
    difficultyBreakdown[String(recipe.difficulty)] = (difficultyBreakdown[String(recipe.difficulty)] ?? 0) + 1;
    if (recipe.computeLines.length === 0) withoutCompute += 1;
    if (recipe.stepMinutesTotal === undefined) withoutStepMinutes += 1;
    separatedUtensilCount += recipe.utensils.length;

    for (const item of [...recipe.requiredItems, ...recipe.optionalItems]) {
      const { normalized } = normalizeIngredientText(item);
      if (!normalized) continue;
      occurrenceCounts.set(normalized, (occurrenceCounts.get(normalized) ?? 0) + 1);
      // 漏网工具抽样：含器皿字样却被当作食材的写法
      if (/[锅碗盆罐杯碟盘砧板刀铲勺筷机箱炉灶台秤纸袋膜棍棒网筛]/.test(normalized)) {
        missedUtensilSamples.set(normalized, (missedUtensilSamples.get(normalized) ?? 0) + 1);
      }
    }
  }

  let mappedOccurrences = 0;
  const mappedNames = new Set<string>();
  const unmapped = new Map<string, number>();
  for (const [name, count] of occurrenceCounts) {
    const mapped = !normalizeIngredientId(name).startsWith("ingredient:");
    if (mapped) {
      mappedOccurrences += count;
      mappedNames.add(name);
    } else {
      unmapped.set(name, count);
    }
  }

  const totalOccurrences = [...occurrenceCounts.values()].reduce((sum, value) => sum + value, 0);
  const topUnmapped = [...unmapped.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([name, count]) => ({
      name,
      count,
      suspectAllergen: SUSPECT_ALLERGEN_WORDS.some((word) => name.includes(word)),
    }));

  return {
    source,
    totals: {
      files: results.length,
      parsed: results.length - failures.length,
      failed: failures.length,
      multiVersion,
      chosenVariantBreakdown,
      withoutCompute,
      withoutStepMinutes,
      difficultyBreakdown,
    },
    failures,
    utensils: {
      separatedCount: separatedUtensilCount,
      missedSamples: [...missedUtensilSamples.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([name, count]) => ({ name, count })),
    },
    coverage: {
      ingredientOccurrences: totalOccurrences,
      mappedOccurrences,
      coverageByOccurrence: totalOccurrences > 0 ? Math.round((1000 * mappedOccurrences) / totalOccurrences) / 1000 : 0,
      distinctNames: occurrenceCounts.size,
      mappedDistinctNames: mappedNames.size,
      coverageByVariant: occurrenceCounts.size > 0 ? Math.round((1000 * mappedNames.size) / occurrenceCounts.size) / 1000 : 0,
    },
    topUnmapped,
  };
}
