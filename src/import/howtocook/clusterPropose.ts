/**
 * P2 分类表扩充：LLM 同义词聚类 + 过敏原提议（人在回路的提议生成器）。
 *
 * 分两步降审核量（已批准方案）：
 * 1. 聚类：未映射写法归并到规范名——审核单位从"写法"变"规范名"；
 * 2. 双通道：
 *    - review：提议含过敏原、或写法命中疑似过敏原词表（含 LLM 提议
 *      "不含过敏原"的，如鸡精/料酒最易漏）→ 逐条人工审核；
 *    - batch：不含过敏原且不命中词表（水/青菜/土豆类）→ 批量通过 +
 *      随机抽 10% 复核。
 * 输出 proposals 文件（data/import/htc-taxonomy-proposals.json）供人工
 * 批注；**过敏原一律以人工批注为准**，批准前不写分类表。
 */
import { normalizeIngredientId } from "../../recipes/ingredientTaxonomy.js";
import { chatJson } from "./llmClient.js";
import type { HtcRawRecipe } from "./types.js";

/** 强疑似过敏原词表：命中即进 review 通道（鸡精/料酒/豆豉教训区 + 蛋奶豆鱼虾等高风险字）。 */
const SUSPECT_STRONG: readonly string[] = [
  "酒", "酱", "豉", "麻油", "香油", "鸡精", "味精", "蚝油", "膏", "奶", "酪",
  "蛋", "麦", "麸", "芝麻", "花生", "坚果", "鱼", "虾", "蟹", "贝", "鱿", "蚝",
  "大豆", "豆", "十三香", "五香粉",
];

/** 弱信号词（粉/面/醋/精）：单字香料粉多为纯香料，降为 batch 但标记供抽检优先。 */
const SUSPECT_WEAK: readonly string[] = ["粉", "面", "醋", "精"];

export interface UnmappedIngredient {
  name: string;
  count: number;
  sampleDishes: string[];
}

interface BatchProposalItem {
  写法: string[];
  规范名: string;
  归入现有分类ID或别名: string;
  建议新分类ID: string | undefined;
  过敏原: string[];
  不确定过敏原: string[];
  依据: string;
}

export interface TaxonomyProposal {
  canonical: string;
  aliases: string[];
  existingMatch: string | undefined;
  suggestedNewId: string | undefined;
  allergens: string[];
  suspectedAllergens: string[];
  rationale: string;
  occurrences: number;
  dishCount: number;
  sampleDishes: string[];
  /** review = 逐条人工审核；batch = 批量通过 + 抽检 10% */
  channel: "review" | "batch";
  /** 命中弱信号词表（batch 通道），抽检时优先 */
  suspectWeak: boolean;
}

/** 从已解析菜谱收集全量未映射写法（带频次与样例菜名）。 */
export function collectUnmapped(recipes: readonly HtcRawRecipe[]): Map<string, UnmappedIngredient> {
  const map = new Map<string, UnmappedIngredient>();
  for (const recipe of recipes) {
    for (const item of [...recipe.requiredItems, ...recipe.optionalItems]) {
      const name = item.trim();
      if (!name) continue;
      if (!normalizeIngredientId(name).startsWith("ingredient:")) continue;
      const entry = map.get(name) ?? { name, count: 0, sampleDishes: [] };
      entry.count += 1;
      if (entry.sampleDishes.length < 3 && !entry.sampleDishes.includes(recipe.name)) {
        entry.sampleDishes.push(recipe.name);
      }
      map.set(name, entry);
    }
  }
  return map;
}

const CLUSTER_SYSTEM_PROMPT = `你是食材规范化助手。输入是菜谱里的未映射食材写法（含频次与样例菜名）。
任务：把同义/近义写法聚类到一个规范名（如"食盐/食用盐/盐"→"盐"；"生粉"若与"淀粉"同义则并入）。
规则：
1. 归入现有分类表时填"归入现有分类ID或别名"（从提供的清单里选最贴切的一个，填原文）；全新食材则留空并填"建议新分类ID"（snake_case 英文）。
2. 过敏原只能用这些 ID：peanut, tree_nut, milk, egg, soy, wheat, gluten, fish, shellfish, sesame；确定才进"过敏原"，拿不准进"不确定过敏原"；判断依据写常见市售产品的配料表（如料酒含小麦、鸡精常含小麦与鸡蛋、豆豉含大豆、麻油含芝麻）。
3. 工具/器皿误入的（锅/碗/模具等）归入规范名"__UTENSIL__"并说明。
4. 输出严格 JSON：{"proposals": [{"写法": [...], "规范名": "...", "归入现有分类ID或别名": "..."|"", "建议新分类ID": "..."|"", "过敏原": [...], "不确定过敏原": [...], "依据": "..."}]}；每个输入写法必须恰好出现在一个聚类的"写法"里。`;

/** 分批聚类提议，返回带通道分流的提案（未含人工批注字段）。 */
export async function clusterPropose(
  unmapped: ReadonlyMap<string, UnmappedIngredient>,
  existingTaxonomySummary: string,
  batchSize = 60,
): Promise<TaxonomyProposal[]> {
  const entries = [...unmapped.values()].sort((a, b) => b.count - a.count);
  const dishNames = new Map<string, string>(); // 写法 → 出现过的菜名并集（用样例即可）
  for (const entry of entries) dishNames.set(entry.name, entry.sampleDishes.join("、"));

  const proposals: TaxonomyProposal[] = [];
  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);
    const userPrompt = [
      `现有分类表（ID与别名节选）：\n${existingTaxonomySummary}`,
      "",
      "未映射食材写法（写法 | 出现次数 | 样例菜）：",
      ...batch.map((entry) => `${entry.name} | ${entry.count} | ${entry.sampleDishes.join("、")}`),
    ].join("\n");
    const result = await chatJson<{ proposals: BatchProposalItem[] }>(CLUSTER_SYSTEM_PROMPT, userPrompt);
    const byName = new Map(batch.map((entry) => [entry.name, entry]));

    for (const item of result.proposals) {
      const validAliases = (item.写法 ?? []).filter((alias) => byName.has(alias));
      const occurrences = validAliases.reduce((sum, alias) => sum + (byName.get(alias)?.count ?? 0), 0);
      const sampleDishes = [...new Set(validAliases.flatMap((alias) => byName.get(alias)?.sampleDishes ?? []))].slice(0, 3);
      const texts = [...validAliases, item.规范名 ?? ""];
      const hitStrong = texts.some((text) => SUSPECT_STRONG.some((word) => text.includes(word)));
      const hitWeak = texts.some((text) => SUSPECT_WEAK.some((word) => text.includes(word)));
      const hasAllergenOpinion = (item.过敏原?.length ?? 0) > 0 || (item.不确定过敏原?.length ?? 0) > 0;
      proposals.push({
        canonical: item.规范名 ?? "",
        aliases: validAliases,
        existingMatch: item.归入现有分类ID或别名 || undefined,
        suggestedNewId: item.建议新分类ID || undefined,
        allergens: item.过敏原 ?? [],
        suspectedAllergens: item.不确定过敏原 ?? [],
        rationale: item.依据 ?? "",
        occurrences,
        dishCount: validAliases.length,
        sampleDishes,
        // 命中强疑似词表但 LLM 说不含过敏原的也进 review（鸡精/料酒教训）
        channel: hasAllergenOpinion || hitStrong ? "review" : "batch",
        suspectWeak: hitWeak,
      });
    }
  }
  // 覆盖完整性：未被任何聚类收纳的写法单独成组（规范名=原写法），标记 review
  const covered = new Set(proposals.flatMap((proposal) => proposal.aliases));
  for (const entry of entries) {
    if (covered.has(entry.name)) continue;
    proposals.push({
      canonical: entry.name,
      aliases: [entry.name],
      existingMatch: undefined,
      suggestedNewId: undefined,
      allergens: [],
      suspectedAllergens: [],
      rationale: "LLM 批次输出未覆盖该写法，单列待人工归类",
      occurrences: entry.count,
      dishCount: 1,
      sampleDishes: entry.sampleDishes,
      channel: "review",
      suspectWeak: false,
    });
  }
  return proposals.sort((a, b) => b.occurrences - a.occurrences);
}
