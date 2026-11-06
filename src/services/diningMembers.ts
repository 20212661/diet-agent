/**
 * 用餐成员的纯函数层（零 IO）：投影合并、解析、并集合成。
 * services/household.ts（要读 store）与各 repository（同层互引、不能反向依赖 services）
 * 共用这一份实现，避免循环加载与逻辑分叉。
 */
import type { UserProfile } from "../types/diet.js";
import type { FoodSafetyProfile } from "../recipes/foodSafety.js";
import type { HouseholdMember } from "../types/diet.js";

/** 用餐成员（虚拟"我" + 物理成员的统一视图）。 */
export interface DiningMember {
  /** "self"（虚拟）或物理成员 ID（"m_" 前缀）。任务状态与计划里只存它。 */
  memberId: string;
  name: string;
  isSelf: boolean;
  allergies: string[];
  avoidFoods: string[];
  preferences: string[];
  notes?: string;
}

/** 保留成员 ID："我"的虚拟投影（不落 household_members 表）。 */
export const SELF_MEMBER_ID = "self";

/** UserProfile → "我"的虚拟成员投影（过敏/忌口/口味来自画像）。 */
export function selfMemberFromProfile(profile: UserProfile | undefined): DiningMember {
  return {
    memberId: SELF_MEMBER_ID,
    name: "我",
    isSelf: true,
    allergies: profile?.allergies ?? [],
    avoidFoods: profile?.avoidFoods ?? [],
    preferences: profile?.preferences ?? [],
  };
}

/** 物理成员行 → DiningMember。 */
export function toDiningMember(member: HouseholdMember): DiningMember {
  return {
    memberId: member.memberId,
    name: member.name,
    isSelf: false,
    allergies: member.allergies,
    avoidFoods: member.avoidFoods,
    preferences: member.preferences,
    notes: member.notes,
  };
}

export interface ResolveResult {
  members: DiningMember[];
  /** 解析不到的引用原文（strict 模式抛错用；ignore 模式调用方可忽略）。 */
  unresolved: string[];
}

/**
 * 纯解析："谁吃"引用（memberId / "我" / "self" / 成员名精确）→ 成员列表。
 * refs 为空 = 全部成员；引用全部失效（如成员已删除）时保守回退为"仅我"，
 * 不能落成空集——空集等于没有安全过滤。
 */
export function resolveDiningRefs(all: readonly DiningMember[], refs?: readonly string[]): ResolveResult {
  if (refs === undefined || refs.length === 0) return { members: [...all], unresolved: [] };
  const byId = new Map(all.map((member) => [member.memberId, member]));
  const byName = new Map(all.map((member) => [member.name, member]));
  const members: DiningMember[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    const member = byId.get(trimmed)
      ?? (trimmed.toLowerCase() === SELF_MEMBER_ID || trimmed === "我" ? byId.get(SELF_MEMBER_ID) : undefined)
      ?? byName.get(trimmed);
    if (!member) {
      unresolved.push(trimmed);
      continue;
    }
    if (!seen.has(member.memberId)) {
      seen.add(member.memberId);
      members.push(member);
    }
  }
  if (members.length === 0) members.push(byId.get(SELF_MEMBER_ID) ?? all[0]!);
  return { members, unresolved };
}

/** 用餐成员的过敏/忌口并集——assessFoodSafety 的输入形状，天然可合成。 */
export function composeDiningSafetyProfile(members: readonly DiningMember[]): FoodSafetyProfile {
  return {
    allergies: [...new Set(members.flatMap((member) => member.allergies))],
    avoidFoods: [...new Set(members.flatMap((member) => member.avoidFoods))],
  };
}

/**
 * 排菜用合成画像："我"的 UserProfile 为基底（目标/健康字段等单人语义不变），
 * 过敏/忌口替换为用餐成员并集。调用方再在其上叠加临时忌口。
 */
export function mergeDiningProfile(base: UserProfile | undefined, members: readonly DiningMember[]): UserProfile {
  const foundation = base ?? ({ userId: "", createdAt: "", updatedAt: "" } as UserProfile);
  const union = composeDiningSafetyProfile(members);
  return { ...foundation, allergies: [...(union.allergies ?? [])], avoidFoods: [...(union.avoidFoods ?? [])] };
}
