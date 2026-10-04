import type { AgentSession } from "@earendil-works/pi-coding-agent";

interface SessionEntry {
  session: AgentSession;
  modelKey: string;
  lastAccessedAt: number;
}

export interface SessionStoreOptions {
  maxSessions: number;
  ttlMs: number;
}

const positiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

let options: SessionStoreOptions = {
  maxSessions: positiveNumber(process.env.SESSION_MAX_COUNT, 100),
  ttlMs: positiveNumber(process.env.SESSION_TTL_MS, 30 * 60_000),
};
const sessionMap = new Map<string, SessionEntry>();

function dispose(session: AgentSession): void {
  try {
    session.dispose();
  } catch {
    // Cleanup is best effort and must not mask the caller's original result.
  }
}

export function configureSessionStore(patch: Partial<SessionStoreOptions>): void {
  options = {
    maxSessions: positiveNumber(String(patch.maxSessions ?? options.maxSessions), options.maxSessions),
    ttlMs: positiveNumber(String(patch.ttlMs ?? options.ttlMs), options.ttlMs),
  };
  enforceCapacity();
}

export function getSessionStoreOptions(): Readonly<SessionStoreOptions> {
  return { ...options };
}

export function sweepExpiredSessions(now = Date.now()): number {
  let removed = 0;
  for (const [userId, entry] of sessionMap) {
    if (now - entry.lastAccessedAt < options.ttlMs) continue;
    sessionMap.delete(userId);
    dispose(entry.session);
    removed += 1;
  }
  return removed;
}

function enforceCapacity(): void {
  while (sessionMap.size > options.maxSessions) {
    let oldest: [string, SessionEntry] | undefined;
    for (const item of sessionMap) {
      if (!oldest || item[1].lastAccessedAt < oldest[1].lastAccessedAt) oldest = item;
    }
    if (!oldest) return;
    sessionMap.delete(oldest[0]);
    dispose(oldest[1].session);
  }
}

export function getSession(userId: string): AgentSession | undefined {
  sweepExpiredSessions();
  const entry = sessionMap.get(userId);
  if (!entry) return undefined;
  entry.lastAccessedAt = Date.now();
  // Refresh insertion order as a deterministic tie-breaker for LRU eviction.
  sessionMap.delete(userId);
  sessionMap.set(userId, entry);
  return entry.session;
}

export function getSessionModelKey(userId: string): string | undefined {
  return sessionMap.get(userId)?.modelKey;
}

export function setSession(userId: string, session: AgentSession, modelKey = "unknown"): void {
  const previous = sessionMap.get(userId);
  if (previous && previous.session !== session) dispose(previous.session);
  sessionMap.delete(userId);
  sessionMap.set(userId, { session, modelKey, lastAccessedAt: Date.now() });
  sweepExpiredSessions();
  enforceCapacity();
}

export function deleteSession(userId: string): void {
  const entry = sessionMap.get(userId);
  if (!entry) return;
  sessionMap.delete(userId);
  dispose(entry.session);
}

export function disposeAllSessions(): void {
  for (const entry of sessionMap.values()) dispose(entry.session);
  sessionMap.clear();
}

export function getActiveUserIds(): string[] {
  sweepExpiredSessions();
  return [...sessionMap.keys()];
}
