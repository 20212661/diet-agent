/**
 * 家庭多人模式：用餐成员的 IO 层（读 store 的解析与投影）。
 *
 * "我"不落 household_members 表——主账号的过敏/忌口/口味继续存 UserProfile
 * （现有工具/表单/评测/隐私路径全部原样生效），运行时投影为虚拟成员。
 * 纯函数（解析/并集/合成）在 diningMembers.ts，供本模块与各 repository 共用。
 *
 * 成员读取统一入口：排菜/过滤/搜索路径只经 resolveDiningMembers 取成员
 * （守卫测试强制），避免散落直查漏掉"我"的投影导致过滤口径不一致。
 *
 * 安全边界：本模块只做数据投影与解析，不做过敏判定——判定永远走
 * assessFoodSafety（画像/成员数据合成的 FoodSafetyProfile）。
 */
import * as store from "../store/index.js";
import type { UserProfile } from "../types/diet.js";
import {
  SELF_MEMBER_ID,
  composeDiningSafetyProfile,
  mergeDiningProfile,
  resolveDiningRefs,
  selfMemberFromProfile,
  toDiningMember,
  type DiningMember,
} from "./diningMembers.js";

export {
  SELF_MEMBER_ID,
  composeDiningSafetyProfile,
  mergeDiningProfile,
} from "./diningMembers.js";
export type { DiningMember } from "./diningMembers.js";
import type { FoodSafetyProfile } from "../recipes/foodSafety.js";

/** 主账号"我"的虚拟成员投影（数据源：UserProfile）。 */
export function selfDiningMember(userId: string): DiningMember {
  return selfMemberFromProfile(store.getUserProfile(userId));
}

/** 全部用餐成员（"我"在前，物理成员按创建顺序）——管理/展示/系统注入用。 */
export function listDiningMembers(userId: string): DiningMember[] {
  return [
    selfDiningMember(userId),
    ...store.listHouseholdMembers(userId).map(toDiningMember),
  ];
}

export interface ResolveDiningMembersOptions {
  /**
   * "strict"：出现解析不到的成员引用（名字/ID 都不匹配）时抛错——
   * 排菜工具入口用，让模型看到参数错误后修正（先 get_household_members），
   * 而不是静默缩小过滤范围。
   * 默认 "ignore"：解析不到的引用直接丢弃——已保存计划/任务状态重放用，
   * 成员被删除后历史计划必须能继续工作（忽略该成员，不抛错）。
   */
  onUnresolved?: "ignore" | "strict";
}

/**
 * 解析"今晚谁吃"：refs 为空/undefined = 全部成员（我 + 物理）。
 * 每个引用按 memberId 精确 → "我"/"self" → 成员名精确的顺序解析；去重、保持顺序。
 */
export function resolveDiningMembers(
  userId: string,
  refs?: readonly string[],
  options: ResolveDiningMembersOptions = {},
): DiningMember[] {
  const { members, unresolved } = resolveDiningRefs(listDiningMembers(userId), refs);
  if (unresolved.length > 0 && options.onUnresolved === "strict") {
    throw new Error(`未找到用餐成员：${unresolved.join("、")}。请先调用 get_household_members 确认成员名或 memberId。`);
  }
  return members;
}

/** 排菜用合成画像（= mergeDiningProfile(store 里的"我"画像, members)）。 */
export function diningProfileForMatching(userId: string, members: readonly DiningMember[]): UserProfile {
  return mergeDiningProfile(store.getUserProfile(userId), members);
}

/** memberId → 显示名（"self"→"我"；已删除的物理成员返回 undefined，注入/展示时跳过）。 */
export function diningMemberNames(userId: string, memberIds: readonly string[]): string[] {
  const byId = new Map(listDiningMembers(userId).map((member) => [member.memberId, member]));
  return memberIds
    .map((id) => byId.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

/** 兼容 re-export：家庭过敏/忌口并集（见 diningMembers.ts）。 */
export function diningSafetyProfile(members: readonly DiningMember[]): FoodSafetyProfile {
  return composeDiningSafetyProfile(members);
}
