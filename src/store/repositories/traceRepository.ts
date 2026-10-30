/**
 * Agent 会话追踪存储。
 *
 * 原则：trace 只记元数据（耗时、token、状态码、模型/工具名），
 * 不存提示词、工具参数或工具结果内容；写入方自行捕获异常，
 * trace 失败绝不影响聊天主流程。
 */
import type Database from "better-sqlite3";

export type TraceStatus =
  | "running"
  | "ok"
  | "verification_required"
  | "failed"
  | "timeout"
  | "budget_exceeded"
  | "interrupted";

export interface AgentTraceRecord {
  traceId: string;
  userId: string;
  operationId?: string;
  sessionId?: string;
  entry: "web" | "tui" | "eval";
  status: TraceStatus;
  errorKind?: string;
  startedAt: number;
  durationMs?: number;
  firstTokenMs?: number;
  attempts: number;
  finalModel?: string;
  llmCalls: number;
  toolCalls: number;
  toolErrors: number;
  /** provider 未上报 usage 时保持 undefined，落库为 NULL，避免把 0 混进平均值。 */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

export interface AgentTraceSpanRecord {
  attempt: number;
  kind: "llm" | "tool" | "retry" | "fallback" | "abort";
  name?: string;
  startedAt: number;
  durationMs?: number;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export const TRACE_RETENTION_DAYS = 30;
export const TRACE_RETENTION_MAX_ROWS = 5_000;
const MAX_SPANS_PER_TRACE = 500;

export function insertRunningAgentTrace(db: Database.Database, record: AgentTraceRecord): void {
  db.prepare(`
    INSERT INTO agent_traces
      (trace_id, user_id, operation_id, session_id, entry, status, started_at, attempts)
    VALUES (?, ?, ?, ?, ?, 'running', ?, 0)
  `).run(
    record.traceId,
    record.userId,
    record.operationId ?? null,
    record.sessionId ?? null,
    record.entry,
    record.startedAt,
  );
}

export function finishAgentTrace(
  db: Database.Database,
  record: AgentTraceRecord,
  spans: readonly AgentTraceSpanRecord[],
): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE agent_traces SET
        status = ?, error_kind = ?, session_id = COALESCE(session_id, ?), duration_ms = ?,
        first_token_ms = ?, attempts = ?, final_model = ?, llm_calls = ?, tool_calls = ?, tool_errors = ?,
        input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?
      WHERE trace_id = ?
    `).run(
      record.status,
      record.errorKind ?? null,
      record.sessionId ?? null,
      record.durationMs ?? null,
      record.firstTokenMs ?? null,
      record.attempts,
      record.finalModel ?? null,
      record.llmCalls,
      record.toolCalls,
      record.toolErrors,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.cacheReadTokens ?? null,
      record.cacheWriteTokens ?? null,
      record.costUsd ?? null,
      record.traceId,
    );
    insertSpans(db, record.traceId, spans);
  })();
}

function insertSpans(db: Database.Database, traceId: string, spans: readonly AgentTraceSpanRecord[]): void {
  const statement = db.prepare(`
    INSERT INTO agent_trace_spans
      (trace_id, attempt, kind, name, started_at, duration_ms, status, input_tokens, output_tokens, cache_read_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const span of spans.slice(0, MAX_SPANS_PER_TRACE)) {
    statement.run(
      traceId,
      span.attempt,
      span.kind,
      span.name ?? null,
      span.startedAt,
      span.durationMs ?? null,
      span.status ?? null,
      span.inputTokens ?? null,
      span.outputTokens ?? null,
      span.cacheReadTokens ?? null,
    );
  }
}

/** 服务启动时把上次进程退出前遗留的 running 记录标为 interrupted（崩溃本身是稳定性指标）。 */
export function markInterruptedAgentTraces(db: Database.Database): number {
  return db.prepare(
    "UPDATE agent_traces SET status = 'interrupted', error_kind = 'process_exit' WHERE status = 'running'",
  ).run().changes;
}

export interface TracePruneResult {
  byAge: number;
  byCount: number;
}

/** 保留最近 TRACE_RETENTION_MAX_ROWS 条且不超过 TRACE_RETENTION_DAYS 天。 */
export function pruneAgentTraces(db: Database.Database, now = Date.now()): TracePruneResult {
  const cutoff = now - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return db.transaction(() => {
    const deleteWithSpans = (where: string, ...params: unknown[]) => {
      db.prepare(`DELETE FROM agent_trace_spans WHERE trace_id IN (SELECT trace_id FROM agent_traces WHERE ${where})`)
        .run(...params);
      return db.prepare(`DELETE FROM agent_traces WHERE ${where}`).run(...params).changes;
    };
    const byAge = deleteWithSpans("started_at < ?", cutoff);
    const threshold = db.prepare(
      `SELECT started_at AS started_at FROM agent_traces ORDER BY started_at DESC LIMIT 1 OFFSET ${TRACE_RETENTION_MAX_ROWS}`,
    ).get() as { started_at: number } | undefined;
    if (!threshold) return { byAge, byCount: 0 };
    return { byAge, byCount: deleteWithSpans("started_at < ?", threshold.started_at) };
  })();
}

/** Web 服务启动时的统一维护入口。 */
export function maintainAgentTraces(db: Database.Database): { interrupted: number; pruned: TracePruneResult } {
  const interrupted = markInterruptedAgentTraces(db);
  const pruned = pruneAgentTraces(db);
  return { interrupted, pruned };
}

export function deleteAgentTracesForUser(db: Database.Database, userId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM agent_trace_spans WHERE trace_id IN (SELECT trace_id FROM agent_traces WHERE user_id = ?)")
      .run(userId);
    db.prepare("DELETE FROM agent_traces WHERE user_id = ?").run(userId);
  })();
}

export interface TraceWindowRow {
  status: TraceStatus;
  error_kind: string | null;
  duration_ms: number | null;
  first_token_ms: number | null;
  attempts: number;
  final_model: string | null;
  llm_calls: number;
  tool_calls: number;
  tool_errors: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
}

export function getTraceWindow(db: Database.Database, sinceMs: number): TraceWindowRow[] {
  return db.prepare(`
    SELECT status, error_kind, duration_ms, first_token_ms, attempts, final_model,
           llm_calls, tool_calls, tool_errors,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
    FROM agent_traces WHERE started_at > ?
    ORDER BY started_at DESC LIMIT 20000
  `).all(sinceMs) as TraceWindowRow[];
}

export interface ToolSpanStat {
  name: string;
  calls: number;
  errorCount: number;
  errorPct: number;
  avgMs: number;
}

export function getToolSpanStats(db: Database.Database, sinceMs: number): ToolSpanStat[] {
  return db.prepare(`
    SELECT name, COUNT(*) AS calls,
           SUM(status = 'error') AS errorCount,
           ROUND(100.0 * SUM(status = 'error') / COUNT(*), 1) AS errorPct,
           CAST(AVG(duration_ms) AS INTEGER) AS avgMs
    FROM agent_trace_spans
    WHERE kind = 'tool' AND started_at > ?
    GROUP BY name ORDER BY errorPct DESC, calls DESC
  `).all(sinceMs) as ToolSpanStat[];
}

export interface DailyTraceUsage {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export function getDailyTraceUsage(db: Database.Database, sinceMs: number): DailyTraceUsage[] {
  return db.prepare(`
    SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS requests,
           SUM(COALESCE(input_tokens, 0)) AS inputTokens,
           SUM(COALESCE(output_tokens, 0)) AS outputTokens,
           SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokens,
           ROUND(SUM(COALESCE(cost_usd, 0)), 4) AS costUsd
    FROM agent_traces WHERE started_at > ?
    GROUP BY day ORDER BY day DESC
  `).all(sinceMs) as DailyTraceUsage[];
}

export interface TraceSpanTimelineRow {
  attempt: number;
  kind: string;
  name: string | null;
  started_at: number;
  duration_ms: number | null;
  status: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
}

export function getTraceSpans(db: Database.Database, traceId: string): TraceSpanTimelineRow[] {
  return db.prepare(`
    SELECT attempt, kind, name, started_at, duration_ms, status, input_tokens, output_tokens, cache_read_tokens
    FROM agent_trace_spans WHERE trace_id = ? ORDER BY started_at, id
  `).all(traceId) as TraceSpanTimelineRow[];
}
