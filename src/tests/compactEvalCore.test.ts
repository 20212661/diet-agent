/**
 * 结构化压缩评测的确定性部分（CI，不依赖网络）：
 *  - DIET_STRUCTURED_COMPACT=off 强制走 SDK 默认压缩（三臂对照的 A/B 臂开关）
 *  - 语义提取用量累计器（bench 单独报告 token/成本的数据源）
 */
import { afterEach, describe, expect, it } from "vitest";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { noteMealPlanToolCall, getInjectableTask } = await import("../tasks/taskStateService.js");
const { structuredCompactionHandler } = await import("../tasks/structuredCompaction.js");
const {
  extractAndApplyTaskPatch,
  getExtractionUsage,
  resetExtractionUsage,
} = await import("../tasks/taskStateExtractor.js");
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

function fakeEvent(): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "e1", messagesToSummarize: [], turnPrefixMessages: [],
      isSplitTurn: false, tokensBefore: 100,
    },
    branchEntries: [], reason: "manual", willRetry: false, signal: new AbortController().signal,
  } as unknown as SessionBeforeCompactEvent;
}

describe("压缩评测开关", () => {
  const original = process.env.DIET_STRUCTURED_COMPACT;
  afterEach(() => {
    if (original === undefined) delete process.env.DIET_STRUCTURED_COMPACT;
    else process.env.DIET_STRUCTURED_COMPACT = original;
  });

  it("off：即使有 active 任务也返回 undefined（评测 A/B 臂走 SDK 默认压缩）", async () => {
    const userId = "sw_1";
    noteMealPlanToolCall(userId, "generate_meal_plan", { ok: true, mealPlanStartDate: "2030-04-08" });
    expect(getInjectableTask(userId)).toBeTruthy();

    process.env.DIET_STRUCTURED_COMPACT = "off";
    expect(await structuredCompactionHandler(userId)(fakeEvent())).toBeUndefined();

    delete process.env.DIET_STRUCTURED_COMPACT; // 默认开
    const enabled = await structuredCompactionHandler(userId)(fakeEvent());
    expect(enabled?.compaction?.details).toMatchObject({ structured: true });
  });
});

describe("语义提取用量累计器", () => {
  it("calls/failures/totalMs 随提取累计；reset 归零", async () => {
    resetExtractionUsage();
    const userId = "usage_1";
    noteMealPlanToolCall(userId, "generate_meal_plan", { ok: false });
    const failing = async () => { throw new Error("no key"); };
    const ok = async () => ({ intent: "other" });
    await extractAndApplyTaskPatch(userId, "a", "b", failing);
    await extractAndApplyTaskPatch(userId, "c", "d", ok);
    const usage = getExtractionUsage();
    expect(usage.calls).toBe(2);
    expect(usage.failures).toBe(1);
    expect(usage.totalMs).toBeGreaterThanOrEqual(0);
    resetExtractionUsage();
    expect(getExtractionUsage().calls).toBe(0);
  });
});
