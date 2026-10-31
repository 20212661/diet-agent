import { describe, expect, it } from "vitest";
import { BENCH_CONVERSATIONS, type BenchCategory } from "../eval/benchConversations.js";

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
});
