/**
 * P2-3 分类表生成器：把人工扫表通过的最终判定写成代码数据文件。
 *
 * 数据分为两部分（与"导入菜谱独立文件"同构，不污染人工维护的种子表）：
 * - HTC_INGREDIENT_DEFINITIONS：新建条目
 * - HTC_ALIAS_EXTENSIONS：挂靠现有条目的别名扩展（如 郫县豆瓣→soy_sauce）
 *
 * 人工修订补丁（扫表定案，2026-11-02）：
 * - 十三香/五香粉 → possible wheat（B 组采纳第二意见，复合调料）
 * - 豆芽 → possible soy（泛写，不能确认不是黄豆芽）
 * - 青豆 → possible soy（可能是毛豆；与盲标时青豆进 unsure 前后一致）
 * - 田螺 → shellfish 确定（原 R7 possible，螺属贝类，与花蛤同类语义）
 */
import { BASE_INGREDIENT_DEFINITIONS } from "../../recipes/ingredientTaxonomy.js";
import type { AppliedJudgement } from "./applyRules.js";
import { normalizeIngredientText } from "./normalize.js";
import type { AllergenId } from "../../types/diet.js";

interface ManualPatch {
  canonical: string;
  allergens?: AllergenId[];
  possibleAllergens?: AllergenId[];
  reason: string;
}

const MANUAL_PATCHES: readonly ManualPatch[] = [
  { canonical: "十三香", possibleAllergens: ["wheat"], reason: "扫表 2026-11-02：复合调料，部分品牌加小麦粉填充" },
  { canonical: "五香粉", possibleAllergens: ["wheat"], reason: "扫表 2026-11-02：同十三香" },
  { canonical: "豆芽", possibleAllergens: ["soy"], reason: "扫表 2026-11-02：泛写不能确认不是黄豆芽" },
  { canonical: "青豆", possibleAllergens: ["soy"], reason: "扫表 2026-11-02：可能是毛豆（与盲标 unsure 口径一致）" },
  { canonical: "田螺", allergens: ["shellfish"], possibleAllergens: [], reason: "扫表 2026-11-02：螺属贝类，升确定" },
  { canonical: "麦冬", allergens: [], possibleAllergens: [], reason: "词表误伤复核：百合科，非麦" },
  { canonical: "蟹味菇", allergens: [], possibleAllergens: [], reason: "词表误伤复核：蘑菇，非蟹" },
];

export interface GeneratedTaxonomy {
  definitions: Array<{ id: string; aliases: string[]; allergens: string[]; possibleAllergens: string[] }>;
  aliasExtensions: Record<string, string[]>;
  stats: { newEntries: number; aliasExtensions: number; patched: number; skipped: number };
}

function cleanAlias(raw: string): string | undefined {
  const { normalized } = normalizeIngredientText(raw);
  const trimmed = normalized.replace(/（[^）]*$/g, "").trim();
  if (!trimmed || trimmed.length > 12) return trimmed.length > 12 ? undefined : trimmed || undefined;
  return trimmed || undefined;
}

/** 现有分类表别名/ID 查重用 */
function buildExistingIndex(): { ids: Set<string>; aliases: Map<string, string> } {
  const ids = new Set<string>();
  const aliases = new Map<string, string>();
  for (const definition of BASE_INGREDIENT_DEFINITIONS) {
    ids.add(definition.id);
    for (const alias of definition.aliases) aliases.set(alias, definition.id);
  }
  return { ids, aliases };
}

/** existingMatch（LLM 建议挂靠的现有 ID 或别名）解析为现有条目 ID。 */
function resolveExistingId(match: string | undefined, index: { ids: Set<string>; aliases: Map<string, string> }): string | undefined {
  if (!match) return undefined;
  if (index.ids.has(match)) return match;
  return index.aliases.get(match);
}

function toSnakeId(canonical: string): string {
  return canonical.replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unnamed";
}

export function generateTaxonomySource(applied: readonly AppliedJudgement[]): GeneratedTaxonomy {
  const index = buildExistingIndex();
  const definitions: GeneratedTaxonomy["definitions"] = [];
  const aliasExtensions: Record<string, string[]> = {};
  let patched = 0;
  let skipped = 0;
  const takenIds = new Set<string>();
  const takenAliases = new Map<string, string>();

  for (const item of applied) {
    if (item.allergens.length === 0 && item.possibleAllergens.length === 0 && item.aliases.length > 0) {
      // 纯无过敏原的新食材也要建条目（否则永远 ingredient: 前缀 → needs_verification 拦截）
    }
    const patch = MANUAL_PATCHES.find((p) => p.canonical === item.canonical || item.aliases.includes(p.canonical));
    const allergens = patch?.allergens ?? item.allergens;
    const possibleAllergens = patch?.possibleAllergens ?? item.possibleAllergens;
    if (patch) patched += 1;

    const aliases = [...new Set([item.canonical, ...item.aliases].map(cleanAlias)
      .filter((alias): alias is string => typeof alias === "string" && alias.length > 0 && alias.length <= 12))];

    // 挂靠现有条目：扩展别名。要求确定与"可能含"过敏原都被现有条目覆盖——
    // 否则挂靠会静默丢语义（青豆 possible soy 挂 pea 后消失的教训），落新建。
    const existingId = resolveExistingId(item.existingMatch, index);
    if (existingId) {
      const existing = BASE_INGREDIENT_DEFINITIONS.find((definition) => definition.id === existingId)!;
      const existingAllergens = new Set([...(existing.allergens ?? [])]);
      const existingPossible = new Set([...(existing.possibleAllergens ?? [])]);
      const compatible = allergens.every((a) => existingAllergens.has(a))
        && possibleAllergens.every((p) => existingPossible.has(p));
      if (compatible) {
        aliasExtensions[existingId] = [...new Set([...(aliasExtensions[existingId] ?? []), ...aliases])]
          .filter((alias) => !index.aliases.has(alias) && !takenAliases.has(alias));
        for (const alias of aliasExtensions[existingId] ?? []) takenAliases.set(alias, existingId);
        continue;
      }
      // 不兼容（挂靠分类缺过敏原/可能含）→ 落到新建
    }

    // 新建条目：ID 优先用 LLM 建议或规范名
    let id = item.suggestedNewId ?? toSnakeId(item.canonical);
    if (index.ids.has(id) || takenIds.has(id)) id = `htc_${id}`;
    if (takenIds.has(id)) id = `${id}_${definitions.length}`;
    const freshAliases = aliases.filter((alias) => !index.aliases.has(alias) && !takenAliases.has(alias));
    if (freshAliases.length === 0) {
      skipped += 1;
      continue;
    }
    for (const alias of freshAliases) takenAliases.set(alias, id);
    takenIds.add(id);
    definitions.push({ id, aliases: freshAliases, allergens, possibleAllergens });
  }

  return {
    definitions,
    aliasExtensions,
    stats: { newEntries: definitions.length, aliasExtensions: Object.values(aliasExtensions).reduce((sum, list) => sum + list.length, 0), patched, skipped },
  };
}
