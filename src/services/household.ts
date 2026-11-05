/**
 * 家庭多人模式：用餐成员的运行时投影。
 *
 * "我"不落 household_members 表——主账号的过敏/忌口/口味继续存 UserProfile
 * （现有工具/表单/评测/隐私路径全部原样生效），运行时从这里投影为虚拟成员。
 * 物理成员从仓储读取。两层合成统一的 DiningMember 视图，供系统提示、
 * 排菜"今晚谁吃"解析与口味加权消费。
 *
 * 安全边界：本模块只做数据投影与解析，不做过敏判定——判定永远走
 * assessFoodSafety（画像/成员数据合成的 FoodSafetyProfile）。
 */
import * as store from "../store/index.js";
import { SELF_MEMBER_ID } from "../store/repositories/householdMemberRepository.js";

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

/** 主账号"我"的虚拟成员投影（数据源：UserProfile）。 */
export function selfDiningMember(userId: string): DiningMember {
  const profile = store.getUserProfile(userId);
  return {
    memberId: SELF_MEMBER_ID,
    name: "我",
    isSelf: true,
    allergies: profile?.allergies ?? [],
    avoidFoods: profile?.avoidFoods ?? [],
    preferences: profile?.preferences ?? [],
  };
}

/** 全部用餐成员（"我"在前，物理成员按创建顺序）——管理/展示/系统注入用。 */
export function listDiningMembers(userId: string): DiningMember[] {
  return [
    selfDiningMember(userId),
    ...store.listHouseholdMembers(userId).map((member) => ({
      memberId: member.memberId,
      name: member.name,
      isSelf: false,
      allergies: member.allergies,
      avoidFoods: member.avoidFoods,
      preferences: member.preferences,
      notes: member.notes,
    })),
  ];
}
