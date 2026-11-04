/**
 * P5 用户导入的确定性检查：溯源、遗漏、查重、未映射。
 *
 * 溯源（用户口径）：抽取的食材名**或其分类表别名**出现在原文中即算可溯源，
 * 不限字数、不套用 ingredientMatched 的 ≥2 字/禁反向规则（宽松方向）。
 * 无法溯源只标记，由用户删除或保留，不拒绝整条导入。
 *
 * 遗漏：扫描原文中出现的分类表别名，抽取结果没有对应食材则标红，
 * 用户处理（补进食材或明确忽略）后才能入库。带过敏原的排前面。
 * 扫描做覆盖式判定：短别名只在更长别名命中区间内出现时（洋葱⊃葱）
 * 不算独立出现，避免 #29 修过的子串误判以新形式回来。
 */
import type { AllergenId } from "../../types/diet.js";
import {
  INGREDIENT_DEFINITIONS,
  normalizeIngredientId,
} from "../../recipes/ingredientTaxonomy.js";
import { normalizeRecipeName } from "../howtocook/dedupe.js";
import type {
  DuplicateFinding,
  IngredientField,
  OmissionFinding,
  ProvenanceFinding,
  UserRecipeDraft,
} from "./types.js";

export interface FaceIngredient {
  field: IngredientField;
  name: string;
}

/** 全食材面：参与过敏原派生与两项检查的食材来源（与 recipeSchema 校验口径一致）。 */
export function fullIngredientFace(draft: Pick<UserRecipeDraft, "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">): FaceIngredient[] {
  return [
    ...draft.ingredients.map((name) => ({ field: "ingredients" as const, name })),
    ...(draft.optionalIngredients ?? []).map((name) => ({ field: "optionalIngredients" as const, name })),
    ...(draft.vegetables ?? []).map((name) => ({ field: "vegetables" as const, name })),
    ...(draft.staples ?? []).map((name) => ({ field: "staples" as const, name })),
    ...(draft.primaryProtein ? [{ field: "primaryProtein" as const, name: draft.primaryProtein }] : []),
  ];
}

/** 原文的两个扫描面：原文本身 + 去空白版（跨换行的中文别名/英文别名空格差异）。 */
function scanSurfaces(rawText: string): { raw: string; collapsed: string } {
  return { raw: rawText, collapsed: rawText.replace(/\s+/g, "") };
}

function includesAny(surface: { raw: string; collapsed: string }, value: string): boolean {
  if (!value) return false;
  return surface.raw.includes(value) || surface.collapsed.includes(value);
}

/** 溯源：食材名或其分类表别名出现在原文（不限字数；直接子串判定）。 */
export function provenanceCheck(
  draft: Pick<UserRecipeDraft, "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">,
  rawText: string
): ProvenanceFinding[] {
  const surface = scanSurfaces(rawText);
  const findings: ProvenanceFinding[] = [];
  for (const item of fullIngredientFace(draft)) {
    const name = item.name.trim();
    if (!name) continue;
    if (includesAny(surface, name)) continue;
    // 名称本身不在原文 → 查它的分类表别名（normalizeIngredientId 命中的定义）
    const id = normalizeIngredientId(name);
    if (!id.startsWith("ingredient:")) {
      const definition = INGREDIENT_DEFINITIONS.find((def) => def.id === id);
      if (definition && definition.aliases.some((alias) => includesAny(surface, alias))) continue;
    }
    findings.push({ field: item.field, ingredient: name });
  }
  return findings;
}

interface AliasOccurrence {
  alias: string;
  definitionId: string;
  start: number;
  end: number;
}

/** 收集所有别名在原文中的出现区间（只扫原文面；含空格的英文别名加扫去空白面）。 */
function collectOccurrences(rawText: string): AliasOccurrence[] {
  const collapsed = rawText.replace(/\s+/g, "");
  const occurrences: AliasOccurrence[] = [];
  for (const definition of INGREDIENT_DEFINITIONS) {
    for (const alias of definition.aliases) {
      if (!alias) continue;
      let from = rawText.indexOf(alias);
      while (from !== -1) {
        occurrences.push({ alias, definitionId: definition.id, start: from, end: from + alias.length });
        from = rawText.indexOf(alias, from + 1);
      }
      if (/\s/.test(alias) && collapsed.includes(alias.replace(/\s+/g, ""))) {
        // 英文别名的空格差异只判"出现过"，不再逐区间（覆盖式判定对英文别名意义不大）
        occurrences.push({ alias, definitionId: definition.id, start: -1, end: -1 });
      }
    }
  }
  return occurrences;
}

/**
 * 遗漏检查：原文出现分类表别名、抽取结果没有对应食材。
 * 覆盖式判定：某次出现完全落在**另一个**条目更长别名的命中区间内时不算
 * （"洋葱"已抽出时，其中的"葱"不算独立出现；同一条目的嵌套别名不影响判定）。
 */
export function omissionCheck(
  draft: Pick<UserRecipeDraft, "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">,
  rawText: string
): OmissionFinding[] {
  const extractedIds = new Set(fullIngredientFace(draft).map((item) => normalizeIngredientId(item.name)));
  const uncovered = uncoveredOccurrencesByDefinition(rawText);

  const findings: OmissionFinding[] = [];
  for (const [definitionId, occurrence] of uncovered) {
    if (extractedIds.has(definitionId)) continue;
    const definition = INGREDIENT_DEFINITIONS.find((def) => def.id === definitionId);
    if (!definition) continue;
    const snippetStart = Math.max(0, occurrence.start - 8);
    const snippetEnd = Math.min(rawText.length, occurrence.end + 8);
    findings.push({
      alias: occurrence.alias,
      definitionId,
      displayName: definitionId.includes("_") ? definitionId.split("_").map((part) => part).join(" ") : definitionId,
      allergens: [...(definition.allergens ?? [])] as AllergenId[],
      possibleAllergens: [...(definition.possibleAllergens ?? [])] as AllergenId[],
      snippet: occurrence.start >= 0 ? rawText.slice(snippetStart, snippetEnd).replace(/\s+/g, " ").trim() : occurrence.alias,
    });
  }
  // 带过敏原的（确定或可能含）排前面
  findings.sort((a, b) => Number(b.allergens.length + b.possibleAllergens.length > 0) - Number(a.allergens.length + a.possibleAllergens.length > 0));
  return findings;
}

/**
 * 原文中每个分类条目的"未被覆盖出现"（不论是否已抽取）。
 * 评测用：检查器遗漏率 = 其中带过敏原的条目既不在抽取面、也不在遗漏检查结果里。
 */
export function uncoveredOccurrencesByDefinition(rawText: string): Map<string, AliasOccurrence> {
  const occurrences = collectOccurrences(rawText);
  const uncovered = new Map<string, AliasOccurrence>();
  for (const occurrence of occurrences) {
    const covered = occurrence.start >= 0 && occurrences.some((other) =>
      other.definitionId !== occurrence.definitionId
      && other.start >= 0
      && other.start <= occurrence.start
      && occurrence.end <= other.end
      && other.end - other.start > occurrence.end - occurrence.start
    );
    if (!covered && !uncovered.has(occurrence.definitionId)) {
      uncovered.set(occurrence.definitionId, occurrence);
    }
  }
  return uncovered;
}

/** 未映射：食材不在分类表中（ingredient: 前缀哨兵），无法核对过敏原。 */
export function unmappedCheck(
  draft: Pick<UserRecipeDraft, "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">
): string[] {
  const unmapped = new Set<string>();
  for (const item of fullIngredientFace(draft)) {
    const name = item.name.trim();
    if (!name) continue;
    if (normalizeIngredientId(name).startsWith("ingredient:")) unmapped.add(name);
  }
  return [...unmapped];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * 查重：与全局库或自己已有菜谱对比（提示性，不拦截——允许保存为自己的版本）。
 * 规则与 HowToCook 管道 dedupe 一致：规范化菜名相同=同名；食材 ID Jaccard≥0.7=疑似。
 */
export function duplicateCheck(
  draft: Pick<UserRecipeDraft, "name" | "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">,
  existingRecipes: ReadonlyArray<Pick<import("../../types/diet.js").RecipeRecord, "id" | "name" | "ingredientIds">>
): DuplicateFinding[] {
  const targetName = normalizeRecipeName(draft.name);
  const targetIds = new Set(fullIngredientFace(draft).map((item) => normalizeIngredientId(item.name)));
  const findings: DuplicateFinding[] = [];
  for (const existing of existingRecipes) {
    if (targetName && normalizeRecipeName(existing.name) === targetName) {
      findings.push({ kind: "name", existingId: existing.id, existingName: existing.name });
      continue;
    }
    const score = jaccard(targetIds, new Set(existing.ingredientIds));
    if (score >= 0.7) {
      findings.push({ kind: "ingredient", existingId: existing.id, existingName: existing.name, jaccard: Math.round(score * 100) / 100 });
    }
  }
  return findings;
}
