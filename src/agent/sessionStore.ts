/**
 * Session 存储 - 管理 userId -> AgentSession 的映射
 *
 * 同一个 userId 复用同一个 session。
 * 不同 userId 的 session 互相隔离。
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

const sessionMap = new Map<string, AgentSession>();

/** 获取 userId 对应的 session */
export function getSession(userId: string): AgentSession | undefined {
  return sessionMap.get(userId);
}

/** 存储 userId -> session */
export function setSession(userId: string, session: AgentSession): void {
  sessionMap.set(userId, session);
}

/** 删除 session */
export function deleteSession(userId: string): void {
  sessionMap.delete(userId);
}

/** 获取当前所有活跃 userId */
export function getActiveUserIds(): string[] {
  return [...sessionMap.keys()];
}
