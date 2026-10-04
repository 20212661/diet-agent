import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  configureSessionStore,
  deleteSession,
  disposeAllSessions,
  getActiveUserIds,
  getSession,
  getSessionModelKey,
  setSession,
  sweepExpiredSessions,
} from "../agent/sessionStore.js";

function fakeSession(id: string) {
  return { sessionId: id, dispose: vi.fn() } as unknown as AgentSession;
}

afterEach(() => {
  disposeAllSessions();
  configureSessionStore({ maxSessions: 100, ttlMs: 30 * 60_000 });
  vi.useRealTimers();
});

describe("SessionStore LRU/TTL", () => {
  it("超过容量时淘汰最久未访问会话并 dispose", () => {
    vi.useFakeTimers();
    configureSessionStore({ maxSessions: 2, ttlMs: 60_000 });
    const first = fakeSession("first");
    const second = fakeSession("second");
    const third = fakeSession("third");
    vi.setSystemTime(1_000);
    setSession("u1", first, "m1");
    vi.setSystemTime(2_000);
    setSession("u2", second, "m2");
    vi.setSystemTime(3_000);
    expect(getSession("u1")).toBe(first);
    vi.setSystemTime(4_000);
    setSession("u3", third, "m3");

    expect(getActiveUserIds().sort()).toEqual(["u1", "u3"]);
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(getSessionModelKey("u1")).toBe("m1");
  });

  it("TTL 到期和显式删除都会释放资源", () => {
    vi.useFakeTimers();
    configureSessionStore({ maxSessions: 10, ttlMs: 1_000 });
    const expired = fakeSession("expired");
    const deleted = fakeSession("deleted");
    vi.setSystemTime(1_000);
    setSession("expired", expired);
    vi.setSystemTime(2_001);
    expect(sweepExpiredSessions()).toBe(1);
    expect(expired.dispose).toHaveBeenCalledOnce();

    setSession("deleted", deleted);
    deleteSession("deleted");
    expect(deleted.dispose).toHaveBeenCalledOnce();
  });

  it("统一清理释放所有会话", () => {
    const sessions = [fakeSession("a"), fakeSession("b")];
    setSession("a", sessions[0]);
    setSession("b", sessions[1]);
    disposeAllSessions();
    expect(getActiveUserIds()).toEqual([]);
    expect(sessions.every((session) => vi.mocked(session.dispose).mock.calls.length === 1)).toBe(true);
  });
});
