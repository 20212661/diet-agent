import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnGuard, loadRequestDeadlineMs, loadTurnLimits, type TurnLimits } from "../agent/turnGuard.js";

const limits = (patch: Partial<TurnLimits> = {}): TurnLimits => ({
  deadlineMs: 60_000,
  idleMs: 5_000,
  maxToolCalls: 3,
  maxLlmCalls: 2,
  abortGraceMs: 100,
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTurnGuard", () => {
  it("连续无事件时按 idle 触发", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    vi.advanceTimersByTime(4_999);
    expect(onTrip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: "idle" });
    guard.dispose();
  });

  it("touch 会重置 idle 计时", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(4_000);
      guard.touch();
    }
    expect(onTrip).not.toHaveBeenCalled();
    guard.dispose();
  });

  it("工具执行期间暂停 idle 计时，结束后恢复", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    guard.onToolStart();
    vi.advanceTimersByTime(40_000);
    expect(onTrip).not.toHaveBeenCalled();
    guard.onToolEnd();
    vi.advanceTimersByTime(4_999);
    expect(onTrip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTrip).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it("持续有事件也逃不过 deadline", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits({ deadlineMs: 10_000, idleMs: 2_000 }), onTrip);
    for (let elapsed = 0; elapsed < 10_000; elapsed += 1_000) {
      vi.advanceTimersByTime(1_000);
      guard.touch();
    }
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: "deadline" });
    guard.dispose();
  });

  it("工具调用超过上限触发 tool_budget", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    for (let i = 0; i < 3; i++) {
      guard.onToolStart();
      guard.onToolEnd();
    }
    expect(onTrip).not.toHaveBeenCalled();
    guard.onToolStart();
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: "tool_budget" });
    guard.dispose();
  });

  it("模型请求超过上限触发 llm_budget", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    guard.onLlmStart();
    guard.onLlmStart();
    expect(onTrip).not.toHaveBeenCalled();
    guard.onLlmStart();
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: "llm_budget" });
    guard.dispose();
  });

  it("SDK 自动重试的退避等待会延长 idle 计时", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits({ idleMs: 5_000 }), onTrip);
    guard.onRetryBackoff(8_000);
    vi.advanceTimersByTime(12_999);
    expect(onTrip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: "idle" });
    guard.dispose();
  });

  it("触发后只回调一次，后续事件不再重复触发", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    vi.advanceTimersByTime(5_000);
    expect(onTrip).toHaveBeenCalledTimes(1);
    guard.touch();
    guard.onToolStart();
    vi.advanceTimersByTime(60_000);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(guard.tripped).toMatchObject({ reason: "idle" });
    guard.dispose();
  });

  it("dispose 后不再触发任何限制", () => {
    const onTrip = vi.fn();
    const guard = createTurnGuard(limits(), onTrip);
    guard.dispose();
    vi.advanceTimersByTime(120_000);
    expect(onTrip).not.toHaveBeenCalled();
    expect(guard.tripped).toBeUndefined();
  });
});

describe("loadTurnLimits / loadRequestDeadlineMs", () => {
  it("从环境变量读取覆盖值，非法值回退默认", () => {
    const env = {
      AGENT_TURN_TIMEOUT_MS: "30000",
      AGENT_IDLE_TIMEOUT_MS: "abc",
      AGENT_MAX_TOOL_CALLS: "5",
    };
    expect(loadTurnLimits(env as NodeJS.ProcessEnv)).toMatchObject({
      deadlineMs: 30_000,
      idleMs: 45_000,
      maxToolCalls: 5,
    });
    expect(loadRequestDeadlineMs({ AGENT_REQUEST_TIMEOUT_MS: "90000" } as NodeJS.ProcessEnv)).toBe(90_000);
    expect(loadRequestDeadlineMs({} as NodeJS.ProcessEnv)).toBe(180_000);
  });
});
