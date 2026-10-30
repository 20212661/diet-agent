import { afterAll, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const { createTraceRecorder } = await import("../agent/traceRecorder.js");
const { getDatabase, closeDatabase } = await import("../store/database.js");
const repo = await import("../store/repositories/traceRepository.js");
const { createDietAgentDispatcher } = await import("../agent/createDietAgent.js");

const asEvent = (event: unknown) => event as AgentSessionEvent;

function assistantEnd(usage: Record<string, unknown> | undefined, stopReason = "stop") {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      model: "glm-4.7",
      responseModel: "glm-4.7-actual",
      stopReason,
      usage,
    },
  };
}

describe("TraceRecorder", () => {
  it("请求开始即写入 running 行，结束时补全汇总与 span", () => {
    const db = getDatabase();
    const tracer = createTraceRecorder({ userId: "u1", operationId: "op-1", entry: "web" });
    const running = db.prepare("SELECT status FROM agent_traces").all() as { status: string }[];
    expect(running).toEqual([{ status: "running" }]);

    tracer.beginAttempt("zai/glm-4.7", "session-1");
    tracer.onEvent(asEvent({ type: "message_start", message: { role: "assistant", content: [] } }));
    tracer.onEvent(asEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你" } }));
    tracer.onEvent(asEvent(assistantEnd({
      input: 100, output: 50, cacheRead: 200, cacheWrite: 10,
      cost: { total: 0.0123 },
    })));
    tracer.onEvent(asEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "log_meal" }));
    tracer.onEvent(asEvent({
      type: "tool_execution_end", toolCallId: "t1", toolName: "log_meal",
      isError: false, result: { details: { saved: true } },
    }));
    tracer.mark("fallback", "deepseek/deepseek-flash");
    tracer.finish("ok");

    const trace = db.prepare(`
      SELECT trace_id, status, error_kind, session_id, entry, attempts, final_model, llm_calls, tool_calls, tool_errors,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, first_token_ms
      FROM agent_traces
    `).get() as Record<string, unknown>;
    expect(trace).toMatchObject({
      status: "ok", session_id: "session-1", entry: "web", attempts: 1,
      final_model: "glm-4.7-actual", llm_calls: 1, tool_calls: 1, tool_errors: 0,
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 200, cache_write_tokens: 10,
      cost_usd: 0.0123,
    });
    expect(trace.first_token_ms).toBeGreaterThanOrEqual(0);

    const spans = repo.getTraceSpans(db, trace.trace_id as string);
    expect(spans.map((span) => span.kind)).toEqual(["llm", "tool", "fallback"]);
    expect(spans[0]).toMatchObject({ kind: "llm", name: "glm-4.7-actual", status: "stop", input_tokens: 100 });
    expect(spans[1]).toMatchObject({ kind: "tool", name: "log_meal", status: "saved=true" });
    expect(spans[2]).toMatchObject({ kind: "fallback", name: "deepseek/deepseek-flash" });
  });

  it("provider 未上报 usage 时 token 列保持 NULL 而不是 0", () => {
    const db = getDatabase();
    const tracer = createTraceRecorder({ userId: "u1", entry: "web" });
    tracer.beginAttempt("deepseek/deepseek-flash");
    tracer.onEvent(asEvent(assistantEnd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })));
    tracer.finish("ok");

    const trace = db.prepare(
      "SELECT input_tokens, output_tokens, cache_read_tokens, cost_usd FROM agent_traces WHERE entry = 'web' ORDER BY started_at DESC LIMIT 1",
    ).get() as Record<string, unknown>;
    expect(trace.input_tokens).toBeNull();
    expect(trace.output_tokens).toBeNull();
    expect(trace.cost_usd).toBeNull();
  });

  it("sink 抛异常不影响 recorder 生命周期", () => {
    const failingSink = {
      insertRunning: () => { throw new Error("db locked"); },
      finish: () => { throw new Error("db locked"); },
    };
    const tracer = createTraceRecorder({ userId: "u1", entry: "tui" }, failingSink);
    expect(() => {
      tracer.beginAttempt("zai/glm-4.7");
      tracer.onEvent(asEvent({ type: "tool_execution_start", toolCallId: "t", toolName: "log_meal" }));
      tracer.finish("failed", "timeout");
    }).not.toThrow();
  });

  it("dispatcher 默认 tracer 完整落库：成功与 verification_required", async () => {
    const db = getDatabase();
    db.exec("DELETE FROM agent_traces");
    const okSession = {
      sessionId: "trace-ok",
      subscribe: (listener: (event: AgentSessionEvent) => void) => {
        listener(asEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "好的" } }));
        listener(asEvent({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "好的" }] }], willRetry: false }));
        return () => {};
      },
      prompt: async () => {},
    };
    const uncertainSession = {
      sessionId: "trace-uncertain",
      subscribe: (listener: (event: AgentSessionEvent) => void) => {
        listener(asEvent({ type: "tool_execution_start", toolCallId: "w", toolName: "log_meal" }));
        listener(asEvent({
          type: "tool_execution_end", toolCallId: "w", toolName: "log_meal",
          isError: true, result: { details: {} },
        }));
        listener(asEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "失败" } }));
        listener(asEvent({ type: "agent_end", messages: [], willRetry: false }));
        return () => {};
      },
      prompt: async () => {},
    };
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [{ key: "k", provider: "p", kind: "sdk-default" as const, label: "only", supportsTools: true, promptPatch: "" }],
      getSession: async (_userId, selected) => (selected.label === "only" ? okSession : uncertainSession),
      resetSession: vi.fn(),
      shouldFallback: () => false,
      getMaxAttempts: () => 1,
      refreshAfterWrite: () => ({}),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    await expect(dispatcher("trace-user", "你好")).resolves.toMatchObject({ reply: "好的" });
    const second = createDietAgentDispatcher({
      resolveCandidates: () => [{ key: "k2", provider: "p", kind: "sdk-default" as const, label: "only2", supportsTools: true, promptPatch: "" }],
      getSession: async () => uncertainSession,
      resetSession: vi.fn(),
      shouldFallback: () => false,
      getMaxAttempts: () => 1,
      refreshAfterWrite: () => ({}),
      logger: { log: vi.fn(), warn: vi.fn() },
    });
    await expect(second("trace-user", "记录午餐")).resolves.toMatchObject({ status: "verification_required" });

    const rows = db.prepare(
      "SELECT status, entry, attempts, tool_calls FROM agent_traces WHERE user_id = ? ORDER BY started_at",
    ).all("trace-user") as Array<{ status: string; entry: string; attempts: number; tool_calls: number }>;
    expect(rows).toEqual([
      { status: "ok", entry: "web", attempts: 1, tool_calls: 0 },
      { status: "verification_required", entry: "web", attempts: 1, tool_calls: 1 },
    ]);
  });
});

describe("trace 生命周期维护", () => {
  it("启动时把遗留 running 标为 interrupted，并按天数/数量清理", () => {
    const db = getDatabase();
    db.exec("DELETE FROM agent_traces");
    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO agent_traces (trace_id, user_id, entry, status, started_at, attempts)
      VALUES (?, ?, 'web', ?, ?, 1)
    `);
    insert.run("stale", "u9", "running", now - 40 * 24 * 3600_000);
    insert.run("interrupted", "u9", "running", now - 1000);
    insert.run("fresh", "u9", "ok", now - 500);

    expect(repo.markInterruptedAgentTraces(db)).toBe(2);
    const pruned = repo.pruneAgentTraces(db, now);
    expect(pruned.byAge).toBe(1);

    const remaining = db.prepare("SELECT trace_id, status FROM agent_traces ORDER BY started_at").all() as Array<{ trace_id: string; status: string }>;
    expect(remaining).toEqual([
      { trace_id: "interrupted", status: "interrupted" },
      { trace_id: "fresh", status: "ok" },
    ]);
  });

  it("按用户删除 trace 时连同 span 一起清除", () => {
    const db = getDatabase();
    db.exec("DELETE FROM agent_traces");
    const recorderA = createTraceRecorder({ userId: "user-a", entry: "web" });
    recorderA.beginAttempt("m");
    recorderA.onEvent(asEvent({ type: "tool_execution_start", toolCallId: "t", toolName: "log_meal" }));
    recorderA.onEvent(asEvent({ type: "tool_execution_end", toolCallId: "t", toolName: "log_meal", isError: false, result: {} }));
    recorderA.finish("ok");
    createTraceRecorder({ userId: "user-b", entry: "web" }).finish("failed", "unknown");

    repo.deleteAgentTracesForUser(db, "user-a");
    const traces = db.prepare("SELECT user_id FROM agent_traces ORDER BY user_id").all();
    const spans = db.prepare("SELECT COUNT(*) AS count FROM agent_trace_spans").get() as { count: number };
    expect(traces).toEqual([{ user_id: "user-b" }]);
    expect(spans.count).toBe(0);
  });
});

describe("trace 查询按入口过滤", () => {
  it("getTraceWindow/getToolSpanStats/getDailyTraceUsage 支持按 entry 过滤（默认排除 eval 由调用方传入）", () => {
    const db = getDatabase();
    db.exec("DELETE FROM agent_traces");
    const seed = (entry: "web" | "tui" | "eval") => {
      const recorder = createTraceRecorder({ userId: "entry-user", entry });
      recorder.beginAttempt("zai/glm-4.7");
      recorder.onEvent(asEvent({ type: "tool_execution_start", toolCallId: `t-${entry}`, toolName: "log_meal" }));
      recorder.onEvent(asEvent({ type: "tool_execution_end", toolCallId: `t-${entry}`, toolName: "log_meal", isError: false, result: {} }));
      recorder.finish("ok");
    };
    seed("web");
    seed("tui");
    seed("eval");

    expect(repo.getTraceWindow(db, 0, ["web", "tui"])).toHaveLength(2);
    expect(repo.getTraceWindow(db, 0, ["eval"])).toHaveLength(1);
    expect(repo.getTraceWindow(db, 0)).toHaveLength(3);

    // 工具统计通过 JOIN agent_traces 联表过滤：排除 eval 后只剩 web+tui 的调用
    expect(repo.getToolSpanStats(db, 0, ["web", "tui"])).toEqual([
      { name: "log_meal", calls: 2, errorCount: 0, errorPct: 0, avgMs: expect.any(Number) },
    ]);
    expect(repo.getToolSpanStats(db, 0, ["eval"])[0].calls).toBe(1);

    expect(repo.getDailyTraceUsage(db, 0, ["eval"])[0].requests).toBe(1);
    expect(repo.getDailyTraceUsage(db, 0, ["web", "tui"])[0].requests).toBe(2);
  });
});

afterAll(() => {
  closeDatabase();
});
