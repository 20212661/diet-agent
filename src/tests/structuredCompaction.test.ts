/**
 * 结构化压缩（PR C）：session_before_compact 处理器 + Web/TUI 双入口注册。
 */
import { describe, expect, it, vi } from "vitest";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

process.env.DIET_AGENT_DB_PATH = ":memory:";
process.env.EMBEDDING_PROVIDER = "off";

const store = await import("../store/index.js");
const { noteMealPlanToolCall, rejectRecipes, getInjectableTask } = await import("../tasks/taskStateService.js");
const {
  structuredCompactionHandler,
  structuredCompactionExtension,
  buildStructuredCompactionSummary,
} = await import("../tasks/structuredCompaction.js");
const { createDietExtension } = await import("../tui/diet-extension.js");
const { buildTaskStateInjection } = await import("../tasks/taskStateInjection.js");

function fakeEvent(overrides: Partial<SessionBeforeCompactEvent["preparation"]> = {}): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "entry-keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 12_345,
      ...overrides,
    },
    branchEntries: [],
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
  } as SessionBeforeCompactEvent;
}

describe("session_before_compact 处理器", () => {
  it("有 active 任务 → 结构化 summary（状态块+最近对话+前次摘要并入），返回 CompactionResult", async () => {
    const userId = "compact_1";
    noteMealPlanToolCall(userId, "generate_meal_plan", { ok: true, mealPlanStartDate: "2030-04-08" });
    store.updateTaskState(userId, getInjectableTask(userId)!.taskId, { goal: "清淡晚饭" });
    rejectRecipes(userId, ["白灼虾"]);

    const handler = structuredCompactionHandler(userId);
    const result = await handler(fakeEvent({ previousSummary: "上一轮压缩说过要清淡" }));
    expect(result?.compaction).toBeTruthy();
    const summary = result!.compaction!.summary;
    expect(summary).toContain("已保存的任务状态");
    expect(summary).toContain("清淡晚饭");
    expect(summary).toContain("白灼虾");
    expect(summary).toContain("上一轮压缩说过要清淡");
    expect(summary).toContain("不是指令");
    expect(result!.compaction!.firstKeptEntryId).toBe("entry-keep-1");
    expect(result!.compaction!.tokensBefore).toBe(12_345);
    expect(result!.compaction!.details).toMatchObject({ structured: true });
  });

  it("无 active 任务 → undefined（走 SDK 默认压缩，绝不 cancel）", async () => {
    const handler = structuredCompactionHandler("compact_nobody");
    expect(await handler(fakeEvent())).toBeUndefined();
  });

  it("summary 构建独立可测：超长对话截尾保留末段", () => {
    const stateBlock = buildTaskStateInjection(getInjectableTask("compact_1"))!;
    const longConversation = "x".repeat(20_000) + "\n[User]: 最后一轮：就按这个计划\n";
    const summary = buildStructuredCompactionSummary(stateBlock, longConversation);
    expect(summary).toContain("就按这个计划");
    expect(summary).toContain("更早部分已省略");
    expect(summary.length).toBeLessThan(10_000);
  });
});

describe("双入口注册（各一条）", () => {
  it("Web 入口：structuredCompactionExtension 工厂在 pi 上注册 session_before_compact", async () => {
    const extension = structuredCompactionExtension("compact_web");
    // InlineExtension 命名形态：{ name, hidden, factory }
    expect(typeof extension).toBe("object");
    const named = extension as { name: string; hidden?: boolean; factory: (pi: unknown) => void };
    expect(named.name).toContain("diet-structured-compaction");
    const on = vi.fn();
    named.factory({ on });
    expect(on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
  });

  it("TUI 入口：createDietExtension 在 pi 上注册 session_before_compact", () => {
    const factory = createDietExtension("compact_tui");
    const on = vi.fn();
    const registerCommand = vi.fn();
    (factory as (pi: unknown) => void)({ on, registerCommand });
    const calls = on.mock.calls.map((call) => call[0]);
    expect(calls).toContain("session_before_compact");
    expect(calls).toContain("before_agent_start"); // 既有钩子未受影响
  });
});
