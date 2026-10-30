import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "../agent/createDietAgent.js";
import type { ModelCandidate } from "../agent/modelAdapter.js";
import { TurnLimitError, type TurnLimits } from "../agent/turnGuard.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const { runAgentSessionTurn } = await import("../agent/createDietAgent.js");
const { ToolTimeoutError, wrapToolsForUser } = await import("../agent/modelAdapter.js");
const { logMealTool } = await import("../tools/logMeal.js");
const store = await import("../store/index.js");

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

  prompt(message: string): Promise<unknown> {
    return this.onPrompt(message, (event) => {
      for (const listener of this.listeners) listener(event as AgentSessionEvent);
    }) ?? Promise.resolve();
  }
}

const never = () => new Promise<void>(() => {});
const textDelta = (delta: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta },
});
const agentEnd = () => ({ type: "agent_end", messages: [], willRetry: false });

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.AGENT_TOOL_TIMEOUT_MS;
});

describe("wrapToolsForUser 工具超时", () => {
  it("读工具超时抛 ToolTimeoutError，且不自动重试", async () => {
    process.env.AGENT_TOOL_TIMEOUT_MS = "50";
    const execute = vi.fn((): Promise<never> => new Promise(() => {}));
    const tool = wrapToolsForUser("timeout-user", [
      { name: "search_recipes", label: "搜索菜谱", description: "d", parameters: Type.Object({}), execute },
    ])[0];

    const pending = tool.execute("call-1", {}, undefined, undefined, {} as never);
    const assertion = expect(pending).rejects.toBeInstanceOf(ToolTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("写工具超时返回结构化 unconfirmed 结果，不抛错、不重试", async () => {
    process.env.AGENT_TOOL_TIMEOUT_MS = "50";
    const execute = vi.fn((): Promise<never> => new Promise(() => {}));
    const tool = wrapToolsForUser("timeout-user", [
      { name: "log_meal", label: "记录饮食", description: "d", parameters: Type.Object({}), execute },
    ])[0];

    const pending = tool.execute("call-1", { userId: "timeout-user" }, undefined, undefined, {} as never);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({
      content: [{ type: "text", text: expect.stringContaining("超时") }],
      details: { status: "unconfirmed", retryForbidden: true },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("unconfirmed 结构化结果在整轮中计入 uncertainWriteTools，要求人工核对", async () => {
    const session = new FakeSession("unconfirmed-session", (_message, emit) => {
      emit({ type: "tool_execution_start", toolCallId: "w1", toolName: "log_meal" });
      emit({
        type: "tool_execution_end", toolCallId: "w1", toolName: "log_meal", isError: false,
        result: { details: { status: "unconfirmed", retryForbidden: true } },
      });
      emit(textDelta("记录可能已保存，请核对。"));
      emit(agentEnd());
    });

    await expect(runAgentSessionTurn(
      session, "u-unconfirmed", "记录午餐", candidate("first"), silentLogger, undefined, limits(),
    )).rejects.toMatchObject({ name: "WriteNeedsVerificationError", toolNames: ["log_meal"] });
  });
});

describe("guard 触发后的会话 fence", () => {
  it("abort 永不返回的会话，超时后再执行写工具被拒绝且不落库；新会话不受影响", async () => {
    const wrapped = wrapToolsForUser("fence-user", [logMealTool]);
    const session = new FakeSession("fence-abort-hang", () => never());
    session.abort.mockImplementation(() => new Promise<void>(() => {}));

    const outcome = capture(runAgentSessionTurn(
      session, "fence-user", "记录午餐", candidate("first"), silentLogger, undefined,
      limits({ deadlineMs: 5_000, idleMs: 60_000, abortGraceMs: 200 }),
    ));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(TurnLimitError);

    // 模拟僵尸 SDK 会话（abort 挂死、循环未停）在超时后补发 log_meal 调用
    const before = store.getAllMealLogs("fence-user").length;
    await expect(
      wrapped[0].execute(
        "late-call",
        { userId: "fence-user", mealType: "lunch", foods: [{ name: "米饭", amount: "1碗" }] },
        undefined, undefined, {} as never,
      ),
    ).rejects.toMatchObject({ name: "FencedToolError" });
    expect(store.getAllMealLogs("fence-user").length).toBe(before);

    // 重建会话（新的 wrapToolsForUser 注册新 fence）后写工具正常可用
    const fresh = wrapToolsForUser("fence-user", [logMealTool])[0];
    await fresh.execute(
      "fresh-call",
      { userId: "fence-user", mealType: "dinner", foods: [{ name: "鸡蛋", amount: "1个" }] },
      undefined, undefined, {} as never,
    );
    expect(store.getAllMealLogs("fence-user").length).toBe(before + 1);
  });
});
