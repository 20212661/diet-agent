/**
 * 家庭成员仓储（PR A：CRUD / 重名与上限校验 / patch 合并语义 / 跨用户隔离）。
 */
import { describe, expect, it } from "vitest";

process.env.DIET_AGENT_DB_PATH = ":memory:";
process.env.EMBEDDING_PROVIDER = "off";

const store = await import("../store/index.js");

describe("家庭成员仓储", () => {
  it("新增成员：生成 memberId、默认空偏好数组；列表按创建顺序返回", () => {
    const userId = "hh_basic_1";
    const first = store.upsertHouseholdMember(userId, undefined, {
      name: "小明",
      allergies: ["虾"],
      avoidFoods: ["香菜"],
      preferences: ["辣"],
    });
    expect(first.memberId).toMatch(/^m_[0-9a-f]{8}$/);
    expect(first.allergies).toEqual(["虾"]);
    expect(first.createdAt).toBeTruthy();

    const second = store.upsertHouseholdMember(userId, undefined, { name: "小红" });
    expect(second.allergies).toEqual([]);
    expect(second.avoidFoods).toEqual([]);
    expect(second.preferences).toEqual([]);

    const names = store.listHouseholdMembers(userId).map((member) => member.name);
    expect(names).toEqual(["小明", "小红"]);
  });

  it("同账号重名拒绝；跨账号同名允许", () => {
    const userId = "hh_name_1";
    store.upsertHouseholdMember(userId, undefined, { name: "小明" });
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "小明" })).toThrow("同名成员");
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: " 小明 " })).toThrow("同名成员"); // 先 trim 再判重

    const other = store.upsertHouseholdMember("hh_name_2", undefined, { name: "小明" });
    expect(other.memberId).toBeTruthy();
  });

  it("成员上限 8 人；超限拒绝新增", () => {
    const userId = "hh_limit_1";
    for (let i = 1; i <= 8; i++) {
      store.upsertHouseholdMember(userId, undefined, { name: `成员${i}` });
    }
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "成员9" })).toThrow("上限");
    // 更新既有成员不受上限影响
    const existing = store.listHouseholdMembers(userId)[0];
    expect(() => store.upsertHouseholdMember(userId, existing.memberId, { allergies: ["花生"] })).not.toThrow();
  });

  it("patch 更新：数组整体替换、undefined 不动、notes null 清除、改重名拒绝", () => {
    const userId = "hh_patch_1";
    const created = store.upsertHouseholdMember(userId, undefined, {
      name: "小明", allergies: ["虾"], notes: "小孩，口味清淡",
    });

    const updated = store.upsertHouseholdMember(userId, created.memberId, {
      allergies: ["虾", "花生"], preferences: ["甜"],
    });
    expect(updated.name).toBe("小明"); // 未传不动
    expect(updated.allergies).toEqual(["虾", "花生"]); // 整体替换
    expect(updated.notes).toBe("小孩，口味清淡");
    expect(updated.createdAt).toBe(created.createdAt);

    const cleared = store.upsertHouseholdMember(userId, created.memberId, { notes: null });
    expect(cleared.notes).toBeUndefined();

    // 改成别人的名字 → 拒绝；改成自己的名字 → 允许（幂等改名）
    store.upsertHouseholdMember(userId, undefined, { name: "小红" });
    expect(() => store.upsertHouseholdMember(userId, created.memberId, { name: "小红" })).toThrow("同名成员");
    expect(() => store.upsertHouseholdMember(userId, created.memberId, { name: " 小明 " })).not.toThrow();
  });

  it("空名/超长校验；不存在的成员更新或删除", () => {
    const userId = "hh_invalid_1";
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "  " })).toThrow("不能为空");
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "a".repeat(25) })).toThrow("过长");
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "ok", notes: "n".repeat(201) })).toThrow("备注过长");
    expect(() => store.upsertHouseholdMember(userId, "m_missing", { name: "x" })).toThrow("不存在");
    expect(store.getHouseholdMember(userId, "m_missing")).toBeUndefined();
    expect(store.removeHouseholdMember(userId, "m_missing")).toBe(false);
  });

  it("过敏/忌口/口味列表限长：每项 ≤20 字、每列表 ≤20 项、不含空项", () => {
    const userId = "hh_list_limit_1";
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["花".repeat(21)] })).toThrow("每项不超过");
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "小明", avoidFoods: [" "] })).toThrow("空项");
    expect(() => store.upsertHouseholdMember(userId, undefined, { name: "小明", preferences: Array.from({ length: 21 }, (_, i) => `口味${i}`) })).toThrow("最多 20 项");
    // 恰好在限内可以通过
    const created = store.upsertHouseholdMember(userId, undefined, {
      name: "小明",
      allergies: Array.from({ length: 20 }, (_, i) => `过敏${i}`),
    });
    expect(created.allergies).toHaveLength(20);
  });

  it("保留字守卫：名字不得用\"我\"/\"self\"；memberId \"self\" 不可增删改（虚拟成员）", () => {
    const userId = "hh_reserved_1";
    for (const reserved of ["我", "self", "Self", " 我 "]) {
      expect(() => store.upsertHouseholdMember(userId, undefined, { name: reserved }), `名字 ${reserved}`).toThrow("保留名");
    }
    // memberId "self"：upsert 与 remove 都拒绝——"我"是从 UserProfile 投影的虚拟成员
    expect(() => store.upsertHouseholdMember(userId, "self", { name: "小明" })).toThrow("保留成员 ID");
    expect(() => store.removeHouseholdMember(userId, "self")).toThrow("保留成员 ID");
    // 改名撞保留字同样拒绝
    const created = store.upsertHouseholdMember(userId, undefined, { name: "小明" });
    expect(() => store.upsertHouseholdMember(userId, created.memberId, { name: "我" })).toThrow("保留名");
    // 物理成员表里永远没有 "self" 行
    expect(store.getHouseholdMember(userId, "self")).toBeUndefined();
  });

  it("删除成员；历史成员 ID 残留在别处不影响再次新增同名", () => {
    const userId = "hh_remove_1";
    const created = store.upsertHouseholdMember(userId, undefined, { name: "小明" });
    expect(store.removeHouseholdMember(userId, created.memberId)).toBe(true);
    expect(store.listHouseholdMembers(userId)).toEqual([]);
    const readded = store.upsertHouseholdMember(userId, undefined, { name: "小明" });
    expect(readded.memberId).not.toBe(created.memberId);
  });

  it("跨用户隔离：成员数据按 userId 分区", () => {
    store.upsertHouseholdMember("hh_iso_1", undefined, { name: "小明", allergies: ["牛奶"] });
    store.upsertHouseholdMember("hh_iso_2", undefined, { name: "小明", allergies: ["鸡蛋"] });
    const a = store.getHouseholdMember("hh_iso_1", store.listHouseholdMembers("hh_iso_1")[0].memberId)!;
    const b = store.getHouseholdMember("hh_iso_2", store.listHouseholdMembers("hh_iso_2")[0].memberId)!;
    expect(a.allergies).toEqual(["牛奶"]);
    expect(b.allergies).toEqual(["鸡蛋"]);
    expect(store.listHouseholdMembers("hh_iso_3")).toEqual([]);
  });
});
