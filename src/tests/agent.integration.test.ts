import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "../agent/createDietAgent.js";
import type { ModelCandidate } from "../agent/modelAdapter.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";
const { createDietAgentDispatcher, runAgentSessionTurn } = await import("../agent/createDietAgent.js");
const { repairToolArguments } = await import("../agent/modelAdapter.js");
const { setActiveUserMessage } = await import("../utils/userTurnContext.js");

const candidate = (label: string): ModelCandidate => ({
  key: `test:${label}`,
  provider: label,
  kind: "sdk-default",
  label,
  supportsTools: true,
  promptPatch: "",
});

const silentLogger = { log: vi.fn(), warn: vi.fn() };

class FakeSession implements AgentSessionLike {
  private listeners = new Set<(event: AgentSessionEvent) => void>();

  constructor(
    readonly sessionId: string,
    private readonly onPrompt: (message: string, emit: (event: unknown) => void) => Promise<void> | void
  ) {}

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(message: string): Promise<void> {
    await this.onPrompt(message, (event) => {
      for (const listener of this.listeners) listener(event as AgentSessionEvent);
    });
  }
}

function textDelta(delta: string) {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta },
  };
}

function agentEnd(messages: unknown[], willRetry = false) {
  return { type: "agent_end", messages, willRetry };
}

describe("Agent 会话事件集成", () => {
  it("拼接 text_delta，并等待 willRetry=false 的最终事件", async () => {
    const streamed: string[] = [];
    const session = new FakeSession("stream-session", async (_message, emit) => {
      emit(agentEnd([], true));
      emit(textDelta("连接"));
      emit(textDelta("成功"));
      emit(agentEnd([], false));
    });

    const result = await runAgentSessionTurn(
      session,
      "u1",
      "你好",
      candidate("first"),
      silentLogger,
      { onTextDelta: (text) => streamed.push(text) }
    );
    expect(result.reply).toBe("连接成功");
    expect(streamed).toEqual(["连接", "连接成功"]);
  });

  it("从 agent_end 返回最终 assistant 文本", async () => {
    const session = new FakeSession("final-session", async (_message, emit) => {
      emit(agentEnd([{ role: "assistant", content: [{ type: "text", text: "最终回复" }] }]));
    });

    await expect(runAgentSessionTurn(session, "u1", "你好", candidate("first"), silentLogger))
      .resolves.toMatchObject({ reply: "最终回复" });
  });

  it("将 provider 401 原样分类为模型请求失败", async () => {
    const session = new FakeSession("error-session", async (_message, emit) => {
      emit(agentEnd([{
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "401 Authentication Fails",
      }]));
    });

    await expect(runAgentSessionTurn(session, "u1", "你好", candidate("deepseek"), silentLogger))
      .rejects.toThrow("401 Authentication Fails");
  });

  it("工具报错后无文本时返回明确错误", async () => {
    const session = new FakeSession("tool-error-session", async (_message, emit) => {
      emit({ type: "tool_execution_end", toolName: "search_recipes", isError: true, result: "failed" });
      emit(agentEnd([]));
    });

    await expect(runAgentSessionTurn(session, "u1", "搜索", candidate("tool"), silentLogger))
      .rejects.toThrow("after tool error");
  });

  it("报告工具生命周期但不把敏感参数或结果写入诊断日志", async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const statuses: Array<{ toolName: string; phase: string; outcome?: string }> = [];
    const session = new FakeSession("private-tool-session", async (_message, emit) => {
      emit({ type: "tool_execution_start", toolName: "update_user_profile", args: { allergies: ["secret-allergen"] } });
      emit({ type: "tool_execution_end", toolName: "update_user_profile", isError: false, result: { details: { saved: true, allergies: ["secret-allergen"] } } });
      emit(textDelta("画像已更新"));
      emit(agentEnd([]));
    });

    await runAgentSessionTurn(session, "private-user", "更新过敏信息", candidate("first"), logger, {
      onToolStatus: (status) => statuses.push(status),
    });

    const logs = logger.log.mock.calls.flat().join(" ");
    expect(logs).not.toContain("private-user");
    expect(logs).not.toContain("secret-allergen");
    expect(logs).toContain("outcome=saved=true");
    expect(statuses).toEqual([
      { toolName: "update_user_profile", phase: "pending" },
      { toolName: "update_user_profile", phase: "success", outcome: "saved=true" },
    ]);
  });
});

describe("Agent fallback 与队列集成", () => {
  it("把 Web 请求的稳定 operationId 注入餐食写入工具", () => {
    const clear = setActiveUserMessage("web-user", "记录午餐", "web-operation-123");
    try {
      expect(repairToolArguments("log_meal", { foods: [{ name: "米饭", amount: "1碗" }] }, "web-user"))
        .toMatchObject({ userId: "web-user", operationId: "web-operation-123:log_meal:1" });
      expect(repairToolArguments("log_meal", { foods: [{ name: "鸡蛋", amount: "1个" }] }, "web-user").operationId)
        .toBe("web-operation-123:log_meal:2");
    } finally {
      clear();
    }
  });

  it("工具调用前模型失败后仍切换下一个模型", async () => {
    const first = new FakeSession("first-session", async (_message, emit) => {
      emit(agentEnd([{ role: "assistant", content: [], errorMessage: "HTTP 503 overloaded" }]));
    });
    const second = new FakeSession("second-session", async (_message, emit) => {
      emit(textDelta("备用模型回复"));
      emit(agentEnd([]));
    });
    const resets: string[] = [];
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second")],
      getSession: async (_userId, selected) => selected.label === "first" ? first : second,
      resetSession: (userId) => resets.push(userId),
      shouldFallback: () => true,
      getMaxAttempts: () => 2,
      logger: silentLogger,
    });

    await expect(dispatcher("u1", "你好")).resolves.toMatchObject({
      reply: "备用模型回复",
      sessionId: "second-session",
    });
    expect(resets).toEqual(["u1"]);
  });

  it("无匹配菜谱不算已写入，模型失败后仍允许回退", async () => {
    const first = new FakeSession("no-match-then-503", async (_message, emit) => {
      emit({ type: "tool_execution_start", toolName: "generate_cooking_plan" });
      emit({
        type: "tool_execution_end",
        toolName: "generate_cooking_plan",
        isError: false,
        result: { details: { status: "no_match", selectedRecipes: [] } },
      });
      emit(agentEnd([{ role: "assistant", content: [], errorMessage: "HTTP 503 overloaded" }]));
    });
    const second = new FakeSession("fallback-after-no-match", async (_message, emit) => {
      emit(textDelta("备用模型回复"));
      emit(agentEnd([]));
    });
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second")],
      getSession: async (_userId, selected) => selected.label === "first" ? first : second,
      resetSession: vi.fn(),
      shouldFallback: () => true,
      getMaxAttempts: () => 2,
      logger: silentLogger,
    });

    await expect(dispatcher("u1", "安排晚饭")).resolves.toMatchObject({ reply: "备用模型回复" });
  });

  it("写入工具已开始但未收到结束事件时，不切换模型重做", async () => {
    const first = new FakeSession("write-start-then-crash", async (_message, emit) => {
      emit({ type: "tool_execution_start", toolName: "log_meal" });
      throw new Error("connection lost");
    });
    const secondPrompt = vi.fn(async () => {});
    const second = new FakeSession("must-not-run-after-write-start", secondPrompt);
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second")],
      getSession: async (_userId, selected) => selected.label === "first" ? first : second,
      resetSession: vi.fn(),
      shouldFallback: () => true,
      getMaxAttempts: () => 2,
      refreshAfterWrite: () => ({ mealLogs: [] }),
      logger: silentLogger,
    });

    await expect(dispatcher("u1", "记录午餐")).resolves.toMatchObject({
      status: "verification_required",
      reply: expect.stringContaining("可能已执行"),
    });
    expect(secondPrompt).not.toHaveBeenCalled();
  });

  it("写入工具报错后即使随后同名调用未写入，也保留待核对状态", async () => {
    const first = new FakeSession("write-error-then-no-write", async (_message, emit) => {
      emit({ type: "tool_execution_start", toolName: "log_meal" });
      emit({ type: "tool_execution_end", toolName: "log_meal", isError: true, result: { details: {} } });
      emit({ type: "tool_execution_start", toolName: "log_meal" });
      emit({ type: "tool_execution_end", toolName: "log_meal", isError: false, result: { details: { saved: false } } });
      emit(agentEnd([{ role: "assistant", content: [], errorMessage: "HTTP 503 overloaded" }]));
    });
    const secondPrompt = vi.fn(async () => {});
    const second = new FakeSession("must-not-run-after-tool-error", secondPrompt);
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second")],
      getSession: async (_userId, selected) => selected.label === "first" ? first : second,
      resetSession: vi.fn(), shouldFallback: () => true, getMaxAttempts: () => 2,
      refreshAfterWrite: () => ({ mealLogs: [] }), logger: silentLogger,
    });

    await expect(dispatcher("u1", "记录午餐")).resolves.toMatchObject({ status: "verification_required" });
    expect(secondPrompt).not.toHaveBeenCalled();
  });

  it("写入工具报错但模型给出文字回复时仍要求核对", async () => {
    const session = new FakeSession("write-error-with-text", async (_message, emit) => {
      emit({ type: "tool_execution_start", toolName: "update_ingredient_inventory" });
      emit({ type: "tool_execution_end", toolName: "update_ingredient_inventory", isError: true, result: { details: {} } });
      emit(textDelta("库存更新失败"));
      emit(agentEnd([]));
    });
    await expect(runAgentSessionTurn(session, "u1", "更新库存", candidate("first"), silentLogger))
      .rejects.toMatchObject({ name: "WriteNeedsVerificationError", toolNames: ["update_ingredient_inventory"] });
  });

  it("写入工具成功后模型 503 不会让第二模型重做写入", async () => {
    const first = new FakeSession("write-then-503", async (_message, emit) => {
      emit({
        type: "tool_execution_end",
        toolName: "log_meal",
        isError: false,
        result: { details: { saved: true, id: "meal-1" } },
      });
      emit(agentEnd([{ role: "assistant", content: [], errorMessage: "HTTP 503 overloaded" }]));
    });
    const secondPrompt = vi.fn(async (_message: string, _emit: (event: unknown) => void) => {});
    const second = new FakeSession("must-not-run", secondPrompt);
    const refreshAfterWrite = vi.fn(() => ({ mealLogs: [{ id: "meal-1" }] }));
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("first"), candidate("second")],
      getSession: async (_userId, selected) => selected.label === "first" ? first : second,
      resetSession: vi.fn(),
      shouldFallback: () => true,
      getMaxAttempts: () => 2,
      refreshAfterWrite,
      logger: silentLogger,
    });

    await expect(dispatcher("u1", "记录午餐")).resolves.toMatchObject({
      status: "verification_required",
      reply: expect.stringContaining("操作结果需核对"),
      refreshedData: { mealLogs: [{ id: "meal-1" }] },
    });
    expect(refreshAfterWrite).toHaveBeenCalledWith("u1", ["log_meal"]);
    expect(secondPrompt).not.toHaveBeenCalled();
  });

  it("同一用户请求严格串行，不同用户不共享队列", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const sessions = new Map<string, FakeSession>();
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("only")],
      getSession: async (userId) => {
        let session = sessions.get(userId);
        if (!session) {
          session = new FakeSession(`session-${userId}`, async (message, emit) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            order.push(`start:${message}`);
            await new Promise((resolve) => setTimeout(resolve, message === "first" ? 15 : 1));
            emit(textDelta(message));
            emit(agentEnd([]));
            order.push(`end:${message}`);
            active -= 1;
          });
          sessions.set(userId, session);
        }
        return session;
      },
      resetSession: vi.fn(),
      shouldFallback: () => false,
      getMaxAttempts: () => 1,
      logger: silentLogger,
    });

    const [first, second] = await Promise.all([
      dispatcher("same-user", "first"),
      dispatcher("same-user", "second"),
    ]);
    expect(first.reply).toBe("first");
    expect(second.reply).toBe("second");
    expect(maxActive).toBe(1);
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("前一请求失败后，队列仍能处理下一请求", async () => {
    const session = new FakeSession("recovery-session", async (message, emit) => {
      if (message === "bad") {
        emit(agentEnd([{ role: "assistant", content: [], errorMessage: "invalid_request" }]));
      } else {
        emit(textDelta("恢复成功"));
        emit(agentEnd([]));
      }
    });
    const dispatcher = createDietAgentDispatcher({
      resolveCandidates: () => [candidate("only")],
      getSession: async () => session,
      resetSession: vi.fn(),
      shouldFallback: () => false,
      getMaxAttempts: () => 1,
      logger: silentLogger,
    });

    const failed = dispatcher("u1", "bad");
    const recovered = dispatcher("u1", "good");
    await expect(failed).rejects.toThrow("invalid_request");
    await expect(recovered).resolves.toMatchObject({ reply: "恢复成功" });
  });
});
