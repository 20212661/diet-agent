import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../store/migrations/index.js";
import { claimChatOperation, finishChatOperation, unresolvedChatEvent } from "../web/chatOperationStore.js";

describe("聊天请求持久状态", () => {
  it("重启后返回已完成结果，未完成请求只要求核对，不重复执行", () => {
    const directory = mkdtempSync(join(tmpdir(), "diet-chat-state-"));
    const path = join(directory, "data.sqlite");
    try {
      let db = new Database(path);
      runMigrations(db, path);
      expect(claimChatOperation(db, "user-a", "chat-done-123", "记录午餐", false)).toEqual({ kind: "started" });
      const done = { type: "done", status: "done", reply: "午餐已记录", sessionId: "session-1" } as const;
      finishChatOperation(db, "user-a", "chat-done-123", done);
      expect(claimChatOperation(db, "user-a", "chat-running-123", "更新库存", false)).toEqual({ kind: "started" });
      db.close();

      db = new Database(path);
      runMigrations(db, path);
      expect(claimChatOperation(db, "user-a", "chat-done-123", "记录午餐", false)).toEqual({
        kind: "existing", state: "done", terminalEvent: done,
      });
      expect(claimChatOperation(db, "user-a", "chat-running-123", "更新库存", true)).toMatchObject({
        kind: "existing", state: "running",
      });
      expect(unresolvedChatEvent()).toMatchObject({ type: "result_uncertain", status: "result_uncertain" });
      expect(claimChatOperation(db, "user-a", "chat-done-123", "不同消息", false))
        .toEqual({ kind: "message_conflict" });
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("仅明确确认写入前失败的同一消息可以用原 ID 重试", () => {
    const db = new Database(":memory:");
    runMigrations(db, ":memory:");
    expect(claimChatOperation(db, "user-a", "chat-retry-123", "搜索菜谱", false)).toEqual({ kind: "started" });
    const failed = { type: "failed_before_write", status: "failed_before_write", reply: "模型未连接" } as const;
    finishChatOperation(db, "user-a", "chat-retry-123", failed);
    expect(claimChatOperation(db, "user-a", "chat-retry-123", "搜索菜谱", false)).toMatchObject({
      kind: "existing", state: "failed_before_write", terminalEvent: failed,
    });
    expect(claimChatOperation(db, "user-a", "chat-retry-123", "搜索菜谱", true)).toEqual({ kind: "started" });
    expect(claimChatOperation(db, "user-a", "chat-retry-123", "搜索菜谱", true)).toMatchObject({
      kind: "existing", state: "running",
    });
    db.close();
  });
});
