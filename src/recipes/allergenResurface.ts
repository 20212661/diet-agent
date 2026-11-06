/**
 * 被忽略过敏原警告的跨成员重提示（家庭多人模式）。
 *
 * 语义：导入时"与菜无关"的忽略只对**已确认的成员**负责（confirmedByMemberIds）。
 * 命中的过敏原若涉及未确认的用餐成员——
 *  - 推荐场景（排菜/周计划/搜索）：按 needs_verification 拦截（排除候选），
 *    理由写明涉及哪位成员，直到该成员被确认；
 *  - 查看场景（我的菜谱页）：只显示提示条 + "已为某成员确认"操作。
 *
 * 纯函数：成员列表由调用方传入（推荐路径经 resolveDiningMembers，
 * 查看路径用全部成员），本模块不做 IO。
 */
import type { AllergenId, DismissedAllergenWarning } from "../types/diet.js";
import type { DiningMember } from "../services/diningMembers.js";
import { resolveAllergenIds } from "./ingredientTaxonomy.js";

export interface ResurfacedWarning {
  definitionId: string;
  /** 警告对应的原文别名写法（如"虾"）。 */
  ingredient: string;
  /** 命中的过敏原类别（确定 + 可能含）。 */
  allergens: AllergenId[];
  /** 过敏命中且尚未确认该警告的成员。 */
  affectedMembers: Array<{ memberId: string; name: string }>;
}

/**
 * 计算需要重新提示的警告：每条 dismissed 警告 × 未确认成员的过敏并集取交集。
 * 成员过敏文本按 assessFoodSafety 同一宽松口径展开（resolveAllergenIds，
 * 宁可多提示）。已确认成员（含最初的忽略人）不参与。
 */
export function resurfaceDismissedWarnings(
  warnings: readonly DismissedAllergenWarning[] | undefined,
  members: readonly DiningMember[],
): ResurfacedWarning[] {
  if (!warnings || warnings.length === 0 || members.length === 0) return [];
  const result: ResurfacedWarning[] = [];
  for (const warning of warnings) {
    const warningAllergens = [...warning.allergens, ...warning.possibleAllergens];
    if (warningAllergens.length === 0) continue;
    const affected = members
      .filter((member) => !(warning.confirmedByMemberIds ?? []).includes(member.memberId))
      .filter((member) => {
        const memberAllergens = resolveAllergenIds(member.allergies);
        return memberAllergens.some((allergen) => warningAllergens.includes(allergen));
      })
      .map((member) => ({ memberId: member.memberId, name: member.name }));
    if (affected.length > 0) {
      result.push({
        definitionId: warning.definitionId,
        ingredient: warning.ingredient,
        allergens: [...new Set(warningAllergens)],
        affectedMembers: affected,
      });
    }
  }
  return result;
}

/** 拦截理由（推荐场景 blocker 与查看场景提示条共用文案口径）。 */
export function resurfaceReason(warning: ResurfacedWarning): string {
  const names = warning.affectedMembers.map((member) => member.name).join("、");
  return `导入时曾忽略“${warning.ingredient}”的过敏原警告（${warning.allergens.join("/")}），涉及 ${names} 的过敏且未确认。`;
}
