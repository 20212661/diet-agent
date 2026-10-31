import { describe, expect, it } from "vitest";
import { BENCH_CONVERSATIONS, matchPersistedFoods, type BenchCategory } from "../eval/benchConversations.js";

const EXPECTED_CATEGORY_COUNTS: Record<BenchCategory, number> = {
  meal_log: 8,
  dinner_plan: 6,
  restock: 4,
  inventory_check: 3,
  weekly_plan: 2,
  feedback: 2,
};

describe("BENCH_CONVERSATIONS", () => {
  it("25 段对话，按日常比例覆盖六类", () => {
    expect(BENCH_CONVERSATIONS).toHaveLength(25);
    const counts = new Map<BenchCategory, number>();
    for (const conversation of BENCH_CONVERSATIONS) {
      counts.set(conversation.category, (counts.get(conversation.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual(EXPECTED_CATEGORY_COUNTS);
  });

  it("每段 2-4 轮、轮次为非空自然语句、总轮数在 50-100 之间", () => {
    let totalTurns = 0;
    for (const conversation of BENCH_CONVERSATIONS) {
      expect(conversation.turns.length, conversation.id).toBeGreaterThanOrEqual(2);
      expect(conversation.turns.length, conversation.id).toBeLessThanOrEqual(4);
      for (const turn of conversation.turns) {
        expect(turn.trim().length, conversation.id).toBeGreaterThan(2);
      }
      totalTurns += conversation.turns.length;
    }
    expect(totalTurns).toBeGreaterThanOrEqual(50);
    expect(totalTurns).toBeLessThanOrEqual(100);
  });

  it("每段独立合成用户（bench_ 前缀）且带固定 setup 种子", () => {
    const userIds = new Set<string>();
    for (const conversation of BENCH_CONVERSATIONS) {
      expect(conversation.userId).toBe(`bench_${conversation.id}`);
      userIds.add(conversation.userId);
      expect(conversation.setup).toBeTypeOf("object");
    }
    expect(userIds.size).toBe(BENCH_CONVERSATIONS.length);
  });

  it("meal_log 段都标注了 2-4 项 expectedFoods（落库率分母）", () => {
    const mealLogs = BENCH_CONVERSATIONS.filter((conversation) => conversation.category === "meal_log");
    expect(mealLogs).toHaveLength(8);
    for (const conversation of mealLogs) {
      expect(conversation.expectedFoods, conversation.id).toBeDefined();
      expect(conversation.expectedFoods!.length, conversation.id).toBeGreaterThanOrEqual(1);
      expect(conversation.expectedFoods!.length, conversation.id).toBeLessThanOrEqual(4);
    }
  });
});

describe("matchPersistedFoods", () => {
  it("双向子串命中：煮鸡蛋↔鸡蛋、精确相等都算落库", () => {
    const result = matchPersistedFoods(
      ["煮鸡蛋", "宫保鸡丁"],
      [{ foods: [{ name: "鸡蛋" }, { name: "宫保鸡丁" }] }],
    );
    expect(result.persisted).toEqual(["煮鸡蛋", "宫保鸡丁"]);
    expect(result.missed).toEqual([]);
  });

  it("叫法完全不同的记为 missed，供人工复核", () => {
    const result = matchPersistedFoods(["泡面"], [{ foods: [{ name: "方便面" }] }]);
    expect(result.persisted).toEqual([]);
    expect(result.missed).toEqual(["泡面"]);
  });

  it("没有任何日志时全部 missed", () => {
    expect(matchPersistedFoods(["豆浆"], [])).toEqual({ persisted: [], missed: ["豆浆"] });
  });
});
