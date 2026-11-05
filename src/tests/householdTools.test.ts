/**
 * 家庭成员工具与系统提示注入（PR B）：
 * get 列表含"我"投影；upsert/remove 的确认门与守卫；记忆摘要按需注入成员块。
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { getHouseholdMembersTool } = await import("../tools/getHouseholdMembers.js");
const { upsertHouseholdMemberTool } = await import("../tools/upsertHouseholdMember.js");
const { removeHouseholdMemberTool } = await import("../tools/removeHouseholdMember.js");
const { buildUserMemoryPrompt } = await import("../agent/systemPrompt.js");

const confirmedContext = { hasUI: true, ui: { confirm: async () => true } } as unknown as ExtensionContext;
const declinedContext = { hasUI: true, ui: { confirm: async () => false } } as unknown as ExtensionContext;
const user = (prefix: string) => `${prefix}_${randomUUID()}`;
const textOf = (result: Awaited<ReturnType<any>>): string => {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
};
const execute = (tool: any, params: Record<string, unknown>, ctx = confirmedContext) =>
  tool.execute(randomUUID(), params, undefined, undefined, ctx);

describe("家庭成员工具", () => {
  it("get_household_members：含\"我\"投影（过敏/忌口/口味来自画像）与物理成员", async () => {
    const userId = user("hh_tool_get");
    store.upsertUserProfile(userId, { allergies: ["牛奶"], preferences: ["清淡"] });
    store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });

    const result = await execute(getHouseholdMembersTool, { userId });
    const members = result.details.members;
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ memberId: "self", name: "我", isSelf: true, allergies: ["牛奶"], preferences: ["清淡"] });
    expect(members[1]).toMatchObject({ name: "小明", allergies: ["虾"] });
    expect(textOf(result)).toContain("排菜时：默认全部成员一起吃");
  });

  it("upsert_household_member：无 UI 不写入（confirmationRequired）；确认后写入；取消不写入", async () => {
    const userId = user("hh_tool_upsert");
    const proposal = { userId, name: "小明", allergies: ["虾"], preferences: ["辣"] };

    const noUi = await upsertHouseholdMemberTool.execute(randomUUID(), proposal, undefined, undefined, { hasUI: false } as ExtensionContext);
    expect(noUi.details).toMatchObject({ saved: false, confirmationRequired: true });
    expect(store.listHouseholdMembers(userId)).toHaveLength(0);

    const declined = await execute(upsertHouseholdMemberTool, proposal, declinedContext);
    expect(declined.details).toMatchObject({ saved: false, cancelled: true });
    expect(store.listHouseholdMembers(userId)).toHaveLength(0);

    const saved = await execute(upsertHouseholdMemberTool, proposal);
    expect(saved.details).toMatchObject({ saved: true, name: "小明" });
    expect(textOf(saved)).toContain("memberId");
    expect(store.listHouseholdMembers(userId)).toHaveLength(1);
  });

  it("upsert：更新不存在成员返回 notFound；确认文案包含过敏信息", async () => {
    const userId = user("hh_tool_update");
    const missing = await execute(upsertHouseholdMemberTool, { userId, memberId: "m_missing00", name: "小明" });
    expect(missing.details).toMatchObject({ saved: false, notFound: true });

    const confirm = vi.fn(async () => true);
    const context = { hasUI: true, ui: { confirm } } as unknown as ExtensionContext;
    await upsertHouseholdMemberTool.execute(randomUUID(), { userId, name: "小红", allergies: ["花生"] }, undefined, undefined, context);
    expect(confirm).toHaveBeenCalledWith("确认新增家庭成员", expect.stringContaining("过敏：花生"));
  });

  it("remove：memberId 与名字二选一解析；确认门；不存在的成员 notFound", async () => {
    const userId = user("hh_tool_remove");
    const created = store.upsertHouseholdMember(userId, undefined, { name: "小明", allergies: ["虾"] });

    const byName = await execute(removeHouseholdMemberTool, { userId, name: "小明" }, declinedContext);
    expect(byName.details).toMatchObject({ saved: false, cancelled: true });
    expect(store.listHouseholdMembers(userId)).toHaveLength(1);

    const removed = await execute(removeHouseholdMemberTool, { userId, memberId: created.memberId });
    expect(removed.details).toMatchObject({ saved: true, removedName: "小明" });
    expect(store.listHouseholdMembers(userId)).toHaveLength(0);

    const missing = await execute(removeHouseholdMemberTool, { userId, name: "小明" });
    expect(missing.details).toMatchObject({ saved: false, notFound: true });
  });
});

describe("系统提示的家庭成员注入", () => {
  it("无物理成员时不注入成员块；有成员时注入 memberId 与过敏忌口口味", () => {
    const solo = user("hh_prompt_solo");
    store.upsertUserProfile(solo, { allergies: ["牛奶"] });
    expect(buildUserMemoryPrompt(solo)).not.toContain("### 家庭成员");

    const family = user("hh_prompt_family");
    store.upsertUserProfile(family, { allergies: ["牛奶"] });
    store.upsertHouseholdMember(family, undefined, { name: "小明", allergies: ["虾"], avoidFoods: ["香菜"], preferences: ["辣"] });
    const prompt = buildUserMemoryPrompt(family);
    expect(prompt).toContain("### 家庭成员");
    expect(prompt).toContain("小明");
    expect(prompt).toContain("过敏 虾");
    expect(prompt).toContain("diningMembers");
    // "我"的画像块保持单人语义（不重复投影）
    expect(prompt.match(/### 家庭成员/g)).toHaveLength(1);
  });
});
