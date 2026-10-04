import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const sessionsRoot = fileURLToPath(new URL("../../data/sessions/", import.meta.url));

export function getSessionDirForUser(userId: string): string {
  const hash = createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 32);
  const directory = join(sessionsRoot, hash);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** Reuse the exact active branch when refreshing memory or changing models. */
export function restoreSessionManager(cwd: string, sessionDir: string, current?: SessionManager): SessionManager {
  return current ?? SessionManager.continueRecent(cwd, sessionDir);
}
