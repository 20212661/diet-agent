import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "../agent/createDietAgent.js";
import type { ModelCandidate } from "../agent/modelAdapter.js";
import { TurnLimitError, type TurnLimits } from "../agent/turnGuard.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const { createDietAgentDispatcher, runAgentSessionTurn } = await import("../agent/createDietAgent.js");

const candidate = (label: string): ModelCandidate => ({
  key: `test:${label}`,
  provider: label,
  kind: "sdk-default",
  label,
  supportsTools: true,
  promptPatch: "",
});

const silentLogger = { log: vi.fn(), warn: vi.fn() };

const limits = (patch: Partial<TurnLimits> = {}): TurnLimits => ({
  deadlineMs: 60_000,
  idleMs: 30_000,
  maxToolCalls: 99,
  maxLlmCalls: 99,
  abortGraceMs: 100,
  ...patch,
});

type Emit = (event: unknown) => void;

class FakeSession implements AgentSessionLike {
  private listeners = new Set<(event: AgentSessionEvent) => void>();
  readonly abort = vi.fn(async () => {});

  constructor(
    readonly sessionId: string,
    private readonly onPrompt: (message: string, emit: Emit) => Promise<void> | void,
  ) {}

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(message: string): Promise<unknown> {
    const result = this.onPrompt(message, (event) => {
      for (const listener of this.listeners) listener(event as AgentSessionEvent);
    });
    if (result) await result;
    // SDK 在 agent_end 后完成收尾才发 agent_settled；runAgentSessionTurn
    // 会等 settle 再返回（5s 兜底），假机模拟同一时序避免每轮多等 5s。
    for (const listener of this.listeners) listener({ type: "agent_settled" });
    return undefined;
  }
}

const never = () => new Promise<void>(() => {});
const textDelta = (delta: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta },
});
const agentEnd = () => ({ type: "agent_end", messages: [], willRetry: false });

/** 运行 promise 并记录结果，便于在假定时器下断言“尚未结束”。 */
function capture<T>(promise: Promise<T>) {
  let settled = false;
  let error: unknown;
  let value: T | undefined;
  promise.then(
    (result) => { value = result; settled = true; },
    (cause) => { error = cause; settled = true; },
  );
  return {
    get settled() { return settled; },
    get error() { return error; },
    get value() { return value; },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runAgentSessionTurn 超时与预算", () => {
  it("prompt 挂死且无任何事件时，deadline 触发并调用 abort", async () => {
    const session = new FakeSession("hang-session", () => never());
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "你好", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 5_000, idleMs: 60_000 }),
    ));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(TurnLimitError);
    expect((outcome.error as TurnLimitError).reason).toBe("deadline");
    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("发出文本增量后完全安静时，idle 看门狗触发", async () => {
    const session = new FakeSession("quiet-session", async (_message, emit) => {
      emit(textDelta("正在"));
      await never();
    });
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "你好", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 60_000, idleMs: 3_000 }),
    ));

    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect((outcome.error as TurnLimitError).reason).toBe("idle");
    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("工具执行期间安静不触发 idle，工具结束后恢复计时", async () => {
    let emit: Emit = () => {};
    const session = new FakeSession("tool-session", (_message, push) => {
      emit = push;
      return never();
    });
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "搜索菜谱", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 60_000, idleMs: 3_000 }),
    ));

    emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "search_recipes" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(outcome.settled).toBe(false);

    emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "search_recipes", isError: false, result: { items: [] } });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect((outcome.error as TurnLimitError).reason).toBe("idle");
  });

  it("工具调用次数超过上限触发 tool_budget", async () => {
    let emit: Emit = () => {};
    const session = new FakeSession("loop-session", (_message, push) => {
      emit = push;
      return never();
    });
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "循环", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 60_000, idleMs: 60_000, maxToolCalls: 3 }),
    ));

    for (let i = 0; i < 3; i++) {
      emit({ type: "tool_execution_start", toolCallId: `t${i}`, toolName: "search_recipes" });
      emit({ type: "tool_execution_end", toolCallId: `t${i}`, toolName: "search_recipes", isError: false, result: {} });
    }
    expect(outcome.settled).toBe(false);
    emit({ type: "tool_execution_start", toolCallId: "t3", toolName: "search_recipes" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect((outcome.error as TurnLimitError).reason).toBe("tool_budget");
  });

  it("写工具已开始后超时，抛 WriteNeedsVerificationError 而非静默失败", async () => {
    let emit: Emit = () => {};
    const session = new FakeSession("write-hang", (_message, push) => {
      emit = push;
      return never();
    });
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "记录午餐", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 5_000, idleMs: 60_000 }),
    ));

    emit({ type: "tool_execution_start", toolCallId: "w1", toolName: "log_meal" });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome.settled).toBe(true);
    expect(outcome.error).toMatchObject({ name: "WriteNeedsVerificationError", toolNames: ["log_meal"] });
  });

  it("abort 永不返回时，宽限期后仍能结束本轮", async () => {
    const session = new FakeSession("abort-hang", () => never());
    session.abort.mockImplementation(() => new Promise<void>(() => {}));
    const outcome = capture(runAgentSessionTurn(
      session, "u1", "你好", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 5_000, idleMs: 60_000, abortGraceMs: 200 }),
    ));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(outcome.settled).toBe(true);
    expect((outcome.error as TurnLimitError).reason).toBe("deadline");
  });
});

describe("dispatcher 超时后的队列与降级", () => {
  function buildDispatcher(sessions: Record<string, FakeSession>, patch: Parameters<typeof createDietAgentDispatcher>[0] = {}) {
    return createDietAgentDispatcher({
      resolveCandidates: () => Object.keys(sessions).map(candidate),
      getSession: async (_userId, selected) => sessions[selected.label],
      resetSession: vi.fn(),
      getMaxAttempts: () => Object.keys(sessions).length,
      logger: silentLogger,
      loadTurnLimits: () => limits({ deadlineMs: 5_000, idleMs: 60_000 }),
      loadRequestDeadlineMs: () => 60_000,
      ...patch,
    });
  }

  it("某轮超时后，同一用户的下一条消息不再被卡死（本次修复的 bug）", async () => {
    const session = new FakeSession("recovery", (message, emit) => {
      if (message === "hang") return never();
      emit(textDelta("恢复成功"));
      emit(agentEnd());
    });
    const dispatcher = buildDispatcher({ only: session });

    const first = capture(dispatcher("u1", "hang"));
    await vi.advanceTimersByTimeAsync(5_100);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.settled).toBe(true);
    expect(first.error).toBeInstanceOf(TurnLimitError);

    await expect(dispatcher("u1", "good")).resolves.toMatchObject({ reply: "恢复成功" });
  });

  it("idle 超时会降级到下一个候选模型", async () => {
    const hanging = new FakeSession("idle-first", () => never());
    const backup = new FakeSession("idle-backup", (message, emit) => {
      emit(textDelta("备用回复"));
      emit(agentEnd());
    });
    const dispatcher = buildDispatcher({ first: hanging, second: backup }, {
      loadTurnLimits: () => limits({ deadlineMs: 60_000, idleMs: 3_000 }),
    });

    const outcome = capture(dispatcher("u1", "你好"));
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toMatchObject({ reply: "备用回复", sessionId: "idle-backup" });
    expect(hanging.abort).toHaveBeenCalledTimes(1);
  });

  it("deadline 超时不降级，避免换模型重跑再花一倍时间", async () => {
    const hanging = new FakeSession("deadline-first", () => never());
    const backupPrompt = vi.fn((_message: string, _emit: Emit) => {});
    const backup = new FakeSession("deadline-backup", backupPrompt);
    const dispatcher = buildDispatcher({ first: hanging, second: backup });

    const outcome = capture(dispatcher("u1", "你好"));
    await vi.advanceTimersByTimeAsync(5_100);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(TurnLimitError);
    expect(backupPrompt).not.toHaveBeenCalled();
  });

  it("请求级截止时间用尽后不再尝试剩余候选", async () => {
    const first = new FakeSession("rd-first", () => never());
    const second = new FakeSession("rd-second", () => never());
    const thirdPrompt = vi.fn((_message: string, _emit: Emit) => {});
    const third = new FakeSession("rd-third", thirdPrompt);
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second"), candidate("third")],
      getSession: async (_userId, selected) =>
        selected.label === "first" ? first : selected.label === "second" ? second : third,
      resetSession: vi.fn(),
      shouldFallback: () => true,
      getMaxAttempts: () => 3,
      logger: silentLogger,
      // 第 1 次尝试 idle 3s 触发；剩余 200ms 给第 2 次（单轮 deadline 被压缩到 200ms）；
      // 第 3 次检查时剩余时间已耗尽，直接跳过。
      loadTurnLimits: () => limits({ deadlineMs: 5_000, idleMs: 3_000 }),
      loadRequestDeadlineMs: () => 3_200,
    });

    const outcome = capture(dispatcher("u1", "你好"));
    await vi.advanceTimersByTimeAsync(3_500);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(TurnLimitError);
    expect(thirdPrompt).not.toHaveBeenCalled();
  });
});
