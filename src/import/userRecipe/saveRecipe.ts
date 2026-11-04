/**
 * P5 入库：draft → RecipeRecord → user_recipes。
 *
 * 派生优先：ingredientIds / allergenTags 永远从最终食材面按分类表重算
 * （客户端/LLM 提供的同名字段一律丢弃）。入库前重跑遗漏检查：
 * 仍存在未处理（既没补进食材、也没明确忽略）的遗漏项时拒绝入库。
 */
import { createHash } from "node:crypto";
import type { DismissedAllergenWarning, RecipeRecord } from "../../types/diet.js";
import { deriveRecipeIngredientMetadata } from "../../recipes/ingredientTaxonomy.js";
import { upsertUserRecipe } from "../../store/repositories/userRecipeRepository.js";
import { nowISO } from "../../store/shared.js";
import { fullIngredientFace, omissionCheck } from "./checks.js";
import type { OmissionFinding, UserRecipeDraft } from "./types.js";

/** 遗漏项未处理完就尝试入库时抛出（携带未处理清单，路由转给前端展示）。 */
export class OmissionUnresolvedError extends Error {
  constructor(readonly unresolved: OmissionFinding[]) {
    super(`仍有 ${unresolved.length} 项原文遗漏未处理。`);
    this.name = "OmissionUnresolvedError";
  }
}

/** 幂等 ID：同一用户、同名、同食材面 → 同 id（重导入覆盖更新，不重复入库）。 */
export function userRecipeId(userId: string, draft: Pick<UserRecipeDraft, "name" | "ingredients" | "optionalIngredients" | "vegetables" | "staples" | "primaryProtein">): string {
  const faceIds = fullIngredientFace(draft)
    .map((item) => item.name)
    .sort()
    .join("|");
  const digest = createHash("sha1").update(`${userId}\n${draft.name.trim()}\n${faceIds}`, "utf8").digest("hex");
  return `usr_${digest.slice(0, 8)}`;
}

/** 校验遗漏项全部处理：每个 finding 要么已进食材面，要么被用户明确忽略。 */
export function assertOmissionsResolved(draft: UserRecipeDraft, rawText: string, dismissedOmissionIds: readonly string[]): OmissionFinding[] {
  const dismissed = new Set(dismissedOmissionIds);
  const unresolved = omissionCheck(draft, rawText).filter((finding) => !dismissed.has(finding.definitionId));
  if (unresolved.length > 0) throw new OmissionUnresolvedError(unresolved);
  return unresolved;
}

/**
 * 用户忽略的过敏原警告：只记录带过敏原（确定或可能含）的忽略项——
 * 原文有、用户判定与菜无关。非过敏原忽略（盐/糖漏抽之类）不记。
 * 为家庭多人模式预留：家人查看时可凭此重新提示确认。
 */
export function buildDismissedAllergenWarnings(
  draft: UserRecipeDraft,
  rawText: string,
  dismissedOmissionIds: readonly string[]
): DismissedAllergenWarning[] {
  const dismissed = new Set(dismissedOmissionIds);
  return omissionCheck(draft, rawText)
    .filter((finding) => dismissed.has(finding.definitionId))
    .filter((finding) => finding.allergens.length + finding.possibleAllergens.length > 0)
    .map((finding) => ({
      ingredient: finding.alias,
      definitionId: finding.definitionId,
      allergens: finding.allergens,
      possibleAllergens: finding.possibleAllergens,
      dismissedAt: nowISO(),
    }));
}

/** draft → 完整记录。allergenTags/ingredientIds 从食材面派生，不信任外部输入。 */
export function buildUserRecipeRecord(
  userId: string,
  draft: UserRecipeDraft,
  dismissedAllergenWarnings?: DismissedAllergenWarning[]
): Omit<RecipeRecord, "updatedAt"> {
  const face = fullIngredientFace(draft).map((item) => item.name);
  const derived = deriveRecipeIngredientMetadata(face);
  const mode = draft.modes[0] ?? "stovetop";
  return {
    id: userRecipeId(userId, draft),
    name: draft.name.trim(),
    mode,
    mealTypes: draft.mealTypes as RecipeRecord["mealTypes"],
    modes: draft.modes as RecipeRecord["modes"],
    suitableGoals: draft.suitableGoals,
    ingredients: draft.ingredients,
    optionalIngredients: draft.optionalIngredients,
    ingredientIds: derived.ingredientIds,
    allergenTags: derived.allergenTags,
    primaryProtein: draft.primaryProtein,
    vegetables: draft.vegetables,
    staples: draft.staples,
    cookware: draft.cookware,
    appliances: draft.appliances as RecipeRecord["appliances"],
    activeMinutes: draft.activeMinutes,
    totalMinutes: draft.totalMinutes,
    difficulty: draft.difficulty,
    dishCount: draft.dishCount,
    tasteTags: draft.tasteTags,
    preferenceTags: draft.preferenceTags,
    steps: draft.steps,
    dismissedAllergenWarnings: dismissedAllergenWarnings?.length ? dismissedAllergenWarnings : undefined,
  };
}

/**
 * 校验 + 入库。返回落库记录。
 * RAG 索引不在这一步（保持纯同步可测）；调用方（web 路由）自行 best-effort 增量索引。
 */
export function saveUserRecipe(
  userId: string,
  draft: UserRecipeDraft,
  rawText: string,
  dismissedOmissionIds: readonly string[] = []
): RecipeRecord {
  assertOmissionsResolved(draft, rawText, dismissedOmissionIds);
  const warnings = buildDismissedAllergenWarnings(draft, rawText, dismissedOmissionIds);
  return upsertUserRecipe(userId, buildUserRecipeRecord(userId, draft, warnings));
}
