/**
 * 每个用户请求一个 TraceRecorder 实例：把 SDK 事件流归纳成
 * 一条 agent_traces 记录 + 若干 agent_trace_spans，请求结束时一次性落库。
 *
 * - 只记元数据（耗时/token/状态码/模型与工具名），不记内容。
 * - 所有写入路径自行捕获异常：trace 失败绝不影响聊天。
 * - provider 未上报 usage 时 token 汇总保持 NULL，不存 0。
 */
import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { safeToolOutcome } from "./toolOutcomes.js";
import {
  finishAgentTrace,
  insertRunningAgentTrace,
  type AgentTraceRecord,
  type AgentTraceSpanRecord,
  type TraceStatus,
} from "../store/repositories/traceRepository.js";
import { getDatabase } from "../store/database.js";

export type TraceEntry = "web" | "tui" | "eval";

export interface TraceRecorder {
  /** dispatcher 每次尝试一个候选模型时调用；attempt 序号随之递增。 */
  beginAttempt(modelLabel: string, sessionId?: string): void;
  /** 在 runAgentSessionTurn 的 subscribe 回调里转发原始事件。 */
  onEvent(event: AgentSessionEvent): void;
  /** dispatcher 发生降级或 TurnGuard 触发中止时记录标记 span。 */
  mark(kind: "fallback" | "abort", name: string, status?: string): void;
  finish(status: TraceStatus, errorKind?: string): void;
}

export interface TraceSink {
  insertRunning(record: AgentTraceRecord): void;
  finish(record: AgentTraceRecord, spans: readonly AgentTraceSpanRecord[]): void;
}

/** 生产默认 sink：写入应用 SQLite。 */
export const sqliteTraceSink: TraceSink = {
  insertRunning(record) {
    insertRunningAgentTrace(getDatabase(), record);
  },
  finish(record, spans) {
    finishAgentTrace(getDatabase(), record, spans);
  },
};

interface SpanDraft {
  attempt: number;
  kind: AgentTraceSpanRecord["kind"];
  name?: string;
  startedAt: number;
  durationMs?: number;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

interface TraceContext {
  userId: string;
  operationId?: string;
  entry: TraceEntry;
}

const positive = (value: unknown): value is number => typeof value === "number" && value > 0;

export function createTraceRecorder(context: TraceContext, sink: TraceSink = sqliteTraceSink): TraceRecorder {
  const traceId = randomUUID();
  const startedAt = Date.now();
  let sessionId: string | undefined;
  let attempts = 0;
  let currentAttempt = 0;
  let currentModel = "";
  let finalModel: string | undefined;
  let firstTokenMs: number | undefined;
  let llmCalls = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let llmStartedAt: number | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let sawTokenUsage = false;
  const spans: SpanDraft[] = [];
  const pendingTools = new Map<string, { name: string; startedAt: number }>();

  const addSpan = (span: SpanDraft) => {
    if (spans.length < 500) spans.push(span);
  };

  try {
    sink.insertRunning({
      traceId, userId: context.userId, operationId: context.operationId,
      sessionId, entry: context.entry, status: "running", startedAt,
      attempts: 0, llmCalls: 0, toolCalls: 0, toolErrors: 0,
    });
  } catch {
    // trace 落库失败不影响请求处理；finish 仍会尝试补写。
  }

  return {
    beginAttempt(modelLabel, sid) {
      currentAttempt = attempts + 1;
      attempts = currentAttempt;
      currentModel = modelLabel;
      finalModel = modelLabel;
      if (sid) sessionId = sid;
    },
    onEvent(event) {
      try {
        const now = Date.now();
        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "text_delta" && firstTokenMs === undefined) {
            firstTokenMs = now - startedAt;
          }
          return;
        }
        if (event.type === "message_start") {
          if ((event.message as { role?: unknown } | undefined)?.role === "assistant") {
            if (llmStartedAt === undefined) llmStartedAt = now;
            llmCalls += 1;
          }
          return;
        }
        if (event.type === "message_end") {
          const message = event.message as
            | { role?: unknown; model?: unknown; responseModel?: unknown; stopReason?: unknown; usage?: unknown }
            | undefined;
          if (message?.role !== "assistant") return;
          const durationMs = llmStartedAt !== undefined ? now - llmStartedAt : 0;
          llmStartedAt = undefined;
          if (typeof message.responseModel === "string" && message.responseModel) finalModel = message.responseModel;
          const span: SpanDraft = {
            attempt: currentAttempt,
            kind: "llm",
            name: typeof message.responseModel === "string" && message.responseModel
              || typeof message.model === "string" && message.model
              || currentModel,
            startedAt: now - durationMs,
            durationMs,
            status: typeof message.stopReason === "string" ? message.stopReason : undefined,
          };
          const usage = message.usage as Record<string, unknown> | undefined;
          if (usage && typeof usage === "object") {
            if (positive(usage.input) || positive(usage.output) || positive(usage.cacheRead) || positive(usage.cacheWrite)) {
              sawTokenUsage = true;
              span.inputTokens = Number(usage.input) || undefined;
              span.outputTokens = Number(usage.output) || undefined;
              span.cacheReadTokens = Number(usage.cacheRead) || undefined;
              inputTokens += Number(usage.input) || 0;
              outputTokens += Number(usage.output) || 0;
              cacheReadTokens += Number(usage.cacheRead) || 0;
              cacheWriteTokens += Number(usage.cacheWrite) || 0;
            }
            const cost = usage.cost as Record<string, unknown> | undefined;
            if (cost && typeof cost.total === "number" && cost.total > 0) costUsd += cost.total;
          }
          addSpan(span);
          return;
        }
        if (event.type === "tool_execution_start") {
          toolCalls += 1;
          pendingTools.set(event.toolCallId, { name: event.toolName, startedAt: now });
          return;
        }
        if (event.type === "tool_execution_end") {
          const pending = pendingTools.get(event.toolCallId);
          pendingTools.delete(event.toolCallId);
          if (event.isError) toolErrors += 1;
          addSpan({
            attempt: currentAttempt,
            kind: "tool",
            name: pending?.name ?? event.toolName,
            startedAt: pending?.startedAt ?? now,
            durationMs: pending ? now - pending.startedAt : 0,
            status: event.isError ? "error" : safeToolOutcome(event.result, false),
          });
          return;
        }
        if (event.type === "auto_retry_start") {
          addSpan({
            attempt: currentAttempt,
            kind: "retry",
            name: currentModel,
            startedAt: now,
            durationMs: Math.max(0, event.delayMs || 0),
            status: "backoff",
          });
        }
      } catch {
        // 单个事件归纳失败只丢这一段 trace，不影响主流程。
      }
    },
    mark(kind, name, status) {
      try {
        addSpan({ attempt: currentAttempt, kind, name, startedAt: Date.now(), durationMs: 0, status });
      } catch {
        // ignore
      }
    },
    finish(status, errorKind) {
      try {
        sink.finish(
          {
            traceId,
            userId: context.userId,
            operationId: context.operationId,
            sessionId,
            entry: context.entry,
            status,
            errorKind,
            startedAt,
            durationMs: Date.now() - startedAt,
            firstTokenMs,
            attempts: Math.max(1, attempts),
            finalModel,
            llmCalls,
            toolCalls,
            toolErrors,
            inputTokens: sawTokenUsage ? inputTokens : undefined,
            outputTokens: sawTokenUsage ? outputTokens : undefined,
            cacheReadTokens: sawTokenUsage ? cacheReadTokens : undefined,
            cacheWriteTokens: sawTokenUsage ? cacheWriteTokens : undefined,
            costUsd: costUsd > 0 ? costUsd : undefined,
          },
          spans,
        );
      } catch {
        // ignore
      }
    },
  };
}
