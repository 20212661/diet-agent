import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export class WebWriteConflictError extends Error {
  constructor(message = "请求 ID 已用于不同内容，请刷新后重试。") {
    super(message);
    this.name = "WebWriteConflictError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function executeWebWriteOnce<T>(
  db: Database.Database,
  userId: string,
  route: string,
  payload: Record<string, unknown>,
  action: () => T,
): T {
  const operationId = payload.operationId;
  if (typeof operationId !== "string" || operationId.length < 8 || operationId.length > 200) {
    throw new Error("operationId 必须是 8-200 个字符的客户端操作 ID。");
  }
  const requestHash = createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
  return db.transaction(() => {
    const previous = db.prepare(`
      SELECT request_hash, result_json FROM web_write_operations
      WHERE user_id = ? AND route = ? AND operation_id = ?
    `).get(userId, route, operationId) as { request_hash: string; result_json: string } | undefined;
    if (previous) {
      if (previous.request_hash !== requestHash) throw new WebWriteConflictError();
      return JSON.parse(previous.result_json) as T;
    }
    const result = action();
    db.prepare(`
      INSERT INTO web_write_operations (user_id, route, operation_id, request_hash, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, route, operationId, requestHash, JSON.stringify(result), new Date().toISOString());
    return result;
  })();
}
