import { randomUUID } from "node:crypto";
import { SELF_MEMBER_ID } from "../../services/diningMembers.js";
export { SELF_MEMBER_ID };
import type { HouseholdMember } from "../../types/diet.js";
import { getDatabase } from "../database.js";
import { nowISO, nextUpdatedAt, parseJsonArray, stringifyJson } from "../shared.js";

/** 同账号成员上限：成员列表要进系统提示与"今晚谁吃"选择器，数量必须受限。 */
export const HOUSEHOLD_MEMBER_LIMIT = 8;

/** 成员名/备注长度上限（防滥用；与画像字段限长口径一致）。 */
const NAME_MAX_LENGTH = 24;
const NOTES_MAX_LENGTH = 200;
/** 过敏/忌口/口味列表上限：成员列表要进系统提示与"谁吃"解析，逐项与总量都受限。 */
const LIST_MAX_ITEMS = 20;
const LIST_ITEM_MAX_LENGTH = 20;

function assertMemberListValid(values: string[], label: string): void {
  if (values.length > LIST_MAX_ITEMS) throw new Error(`${label}最多 ${LIST_MAX_ITEMS} 项。`);
  for (const item of values) {
    if (item.trim().length === 0) throw new Error(`${label}不能包含空项。`);
    if (item.length > LIST_ITEM_MAX_LENGTH) throw new Error(`${label}每项不超过 ${LIST_ITEM_MAX_LENGTH} 字。`);
  }
}

/** "我"是主账号的虚拟成员投影（UserProfile），不落本表；保留名与保留 ID 见 diningMembers.ts。 */
const RESERVED_MEMBER_NAMES = new Set(["我", "self"]);

function assertNotReservedMemberId(memberId: string): void {
  if (memberId === SELF_MEMBER_ID) {
    throw new Error(`"${SELF_MEMBER_ID}" 是主账号"我"的保留成员 ID：虚拟成员不可增删改。`);
  }
}

function assertNotReservedMemberName(name: string): void {
  const trimmed = name.trim();
  if (RESERVED_MEMBER_NAMES.has(trimmed) || RESERVED_MEMBER_NAMES.has(trimmed.toLowerCase())) {
    throw new Error(`成员名不能用"${trimmed}"：这是主账号"我"的保留名。`);
  }
}

type MemberRow = Record<string, unknown>;

function rowToMember(row: MemberRow): HouseholdMember {
  return {
    userId: row.user_id as string,
    memberId: row.member_id as string,
    name: row.name as string,
    allergies: parseJsonArray<string>(row.allergies_json as string),
    avoidFoods: parseJsonArray<string>(row.avoid_foods_json as string),
    preferences: parseJsonArray<string>(row.preferences_json as string),
    notes: (row.notes as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listHouseholdMembers(userId: string): HouseholdMember[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM household_members WHERE user_id = ? ORDER BY created_at, member_id")
    .all(userId) as MemberRow[];
  return rows.map(rowToMember);
}

export function getHouseholdMember(userId: string, memberId: string): HouseholdMember | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM household_members WHERE user_id = ? AND member_id = ?")
    .get(userId, memberId) as MemberRow | undefined;
  return row ? rowToMember(row) : undefined;
}

/** patch 语义照 userProfileRepository：数组整体替换、undefined 不动、notes 传 null 清除。 */
export type HouseholdMemberPatch = {
  name?: string;
  allergies?: string[];
  avoidFoods?: string[];
  preferences?: string[];
  notes?: string | null;
};

function assertNameFree(userId: string, name: string, exceptMemberId?: string): void {
  const row = getDatabase()
    .prepare("SELECT member_id FROM household_members WHERE user_id = ? AND name = ?")
    .get(userId, name) as { member_id: string } | undefined;
  if (row && row.member_id !== exceptMemberId) {
    throw new Error(`已有同名成员“${name}”：成员名需唯一，否则“谁吃”解析会产生歧义。`);
  }
}

export function upsertHouseholdMember(
  userId: string,
  memberId: string | undefined,
  patch: HouseholdMemberPatch
): HouseholdMember {
  const db = getDatabase();
  const now = nowISO();
  if (memberId !== undefined) assertNotReservedMemberId(memberId);

  const name = patch.name !== undefined ? patch.name.trim() : undefined;
  if (name !== undefined && name.length === 0) throw new Error("成员名不能为空。");
  if (name !== undefined && name.length > NAME_MAX_LENGTH) {
    throw new Error(`成员名过长（≤${NAME_MAX_LENGTH} 字）。`);
  }
  if (patch.notes !== undefined && patch.notes !== null && patch.notes.length > NOTES_MAX_LENGTH) {
    throw new Error(`成员备注过长（≤${NOTES_MAX_LENGTH} 字）。`);
  }
  if (patch.allergies !== undefined) assertMemberListValid(patch.allergies, "过敏");
  if (patch.avoidFoods !== undefined) assertMemberListValid(patch.avoidFoods, "忌口");
  if (patch.preferences !== undefined) assertMemberListValid(patch.preferences, "口味偏好");

  const row = memberId
    ? (db.prepare("SELECT * FROM household_members WHERE user_id = ? AND member_id = ?")
        .get(userId, memberId) as MemberRow | undefined)
    : undefined;
  if (memberId && !row) throw new Error(`成员不存在：${memberId}`);

  if (!row && listHouseholdMembers(userId).length >= HOUSEHOLD_MEMBER_LIMIT) {
    throw new Error(`家庭成员已达上限（${HOUSEHOLD_MEMBER_LIMIT} 人）。`);
  }

  const existing = row ? rowToMember(row) : undefined;
  const finalName = name ?? existing?.name;
  if (!finalName) throw new Error("新增成员必须提供成员名。");
  assertNotReservedMemberName(finalName);
  assertNameFree(userId, finalName, existing?.memberId);

  const merged: HouseholdMember = {
    userId,
    memberId: existing?.memberId ?? `m_${randomUUID().slice(0, 8)}`,
    name: finalName,
    allergies: patch.allergies !== undefined ? patch.allergies : existing?.allergies ?? [],
    avoidFoods: patch.avoidFoods !== undefined ? patch.avoidFoods : existing?.avoidFoods ?? [],
    preferences: patch.preferences !== undefined ? patch.preferences : existing?.preferences ?? [],
    notes: patch.notes !== undefined ? (patch.notes ?? undefined) : existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: nextUpdatedAt(existing?.updatedAt),
  };

  db.prepare(`
    INSERT INTO household_members (user_id, member_id, name, allergies_json, avoid_foods_json,
      preferences_json, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, member_id) DO UPDATE SET
      name = excluded.name, allergies_json = excluded.allergies_json,
      avoid_foods_json = excluded.avoid_foods_json, preferences_json = excluded.preferences_json,
      notes = excluded.notes, updated_at = excluded.updated_at
  `).run(
    merged.userId, merged.memberId, merged.name,
    stringifyJson(merged.allergies), stringifyJson(merged.avoidFoods), stringifyJson(merged.preferences),
    merged.notes ?? null, merged.createdAt, merged.updatedAt
  );
  return merged;
}

/** 删除成员；不存在返回 false。虚拟成员"我"（self）不可删除。
 *  计划/任务状态里已保存的成员 ID 不做级联改写——重放时按"已删除成员忽略"处理。 */
export function removeHouseholdMember(userId: string, memberId: string): boolean {
  assertNotReservedMemberId(memberId);
  const result = getDatabase()
    .prepare("DELETE FROM household_members WHERE user_id = ? AND member_id = ?")
    .run(userId, memberId);
  return result.changes > 0;
}
