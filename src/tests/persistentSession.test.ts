import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { restoreSessionManager } from "../agent/persistentSession.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function directory() {
  const value = mkdtempSync(join(tmpdir(), "diet-session-regression-"));
  directories.push(value);
  return value;
}

function recordConversation(manager: SessionManager, text: string) {
  manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已记录" }],
    api: "openai-completions", provider: "test", model: "test", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
}

describe("真实 SDK 会话恢复", () => {
  it("重启后恢复同一用户最近的完整消息", () => {
    const dir = directory();
    const first = restoreSessionManager(process.cwd(), dir);
    recordConversation(first, "库存里有黄瓜");
    const recovered = restoreSessionManager(process.cwd(), dir);
    expect(recovered.getSessionId()).toBe(first.getSessionId());
    expect(recovered.buildSessionContext().messages).toEqual(first.buildSessionContext().messages);
  });

  it("记忆更新或换模型时保留准确分支，包括未落盘消息", () => {
    const dir = directory();
    const current = restoreSessionManager(process.cwd(), dir);
    current.appendMessage({ role: "user", content: "请记住这条尚未完成的消息", timestamp: Date.now() });
    expect(restoreSessionManager(process.cwd(), dir, current)).toBe(current);
    recordConversation(SessionManager.create(process.cwd(), dir), "另一个会话");
    expect(restoreSessionManager(process.cwd(), dir, current).getSessionId()).toBe(current.getSessionId());
  });

  it("隔离不同用户目录，空目录仍能新建会话", () => {
    const first = restoreSessionManager(process.cwd(), directory());
    recordConversation(first, "用户 A 的消息");
    const other = restoreSessionManager(process.cwd(), directory());
    expect(other.getSessionId()).not.toBe(first.getSessionId());
    expect(other.buildSessionContext().messages).toEqual([]);
  });
});
