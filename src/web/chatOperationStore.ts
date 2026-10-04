import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export type ChatOperationState = "running" | "done" | "failed_before_write" | "result_uncertain";
export type ChatTerminalEvent = {
  type: Exclude<ChatOperationState, "running">;
  status: Exclude<ChatOperationState, "running">;
  reply: string;
  sessionId?: string;
  refreshedData?: Record<string, unknown>;
};

export type ChatClaim =
  | { kind: "started" }
  | { kind: "message_conflict" }
  | { kind: "existing"; state: ChatOperationState; terminalEvent?: ChatTerminalEvent };

function messageHash(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

function parseTerminalEvent(value: string | null): ChatTerminalEvent | undefined {
  if (!value) return undefined;
  try {
    const event: unknown = JSON.parse(value);
    if (!event || typeof event !== "object") return undefined;
    const record = event as Record<string, unknown>;
    if (!["done", "failed_before_write", "result_uncertain"].includes(String(record.type))
      || record.status !== record.type || typeof record.reply !== "string") return undefined;
    return record as ChatTerminalEvent;
  } catch {
    return undefined;
  }
}

export function claimChatOperation(
  db: Database.Database,
  userId: string,
  operationId: string,
  message: string,
  retryFailedRequest: boolean,
): ChatClaim {
  const hash = messageHash(message);
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT message_hash, state, terminal_event_json FROM chat_operations
      WHERE user_id = ? AND operation_id = ?
    `).get(userId, operationId) as { message_hash: string; state: ChatOperationState; terminal_event_json: string | null } | undefined;
    if (previous) {
      if (previous.message_hash !== hash) return { kind: "message_conflict" } as const;
      if (previous.state === "failed_before_write" && retryFailedRequest) {
        db.prepare(`UPDATE chat_operations SET state = 'running', terminal_event_json = NULL, updated_at = ?
          WHERE user_id = ? AND operation_id = ?`).run(new Date().toISOString(), userId, operationId);
        return { kind: "started" } as const;
      }
      return {
        kind: "existing",
        state: previous.state,
        terminalEvent: parseTerminalEvent(previous.terminal_event_json),
      } as const;
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO chat_operations
      (user_id, operation_id, message_hash, state, terminal_event_json, created_at, updated_at)
      VALUES (?, ?, ?, 'running', NULL, ?, ?)`)
      .run(userId, operationId, hash, now, now);
    return { kind: "started" } as const;
  })();
}

export function finishChatOperation(
  db: Database.Database,
  userId: string,
  operationId: string,
  event: ChatTerminalEvent,
): void {
  const result = db.prepare(`UPDATE chat_operations
    SET state = ?, terminal_event_json = ?, updated_at = ?
    WHERE user_id = ? AND operation_id = ? AND state = 'running'`)
    .run(event.type, JSON.stringify(event), new Date().toISOString(), userId, operationId);
  if (result.changes !== 1) throw new Error("聊天操作状态已变化，无法保存结果。");
}

export function unresolvedChatEvent(): ChatTerminalEvent {
  return {
    type: "result_uncertain",
    status: "result_uncertain",
    reply: "上次请求在服务中断前未保存最终结果。请核对相关记录后再继续；系统不会自动重发。",
  };
}
