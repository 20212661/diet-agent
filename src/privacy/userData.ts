import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../store/index.js";
import { SHOPPING_TABLES } from "../shopping/types.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_ROOT = join(APP_ROOT, "data");
const SESSION_ROOT = join(DATA_ROOT, "sessions");
const EXPORT_ROOT = join(DATA_ROOT, "exports");
const LOG_ROOT = join(APP_ROOT, "logs", "api-requests");
const BACKUP_RETENTION_DAYS = 30;
const BACKUP_RETENTION_MAX = 3;

export interface ConversationExportEntry {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

function digest(value: string, length = 32): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

function countFiles(root: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    count += entry.isDirectory() ? countFiles(path) : entry.isFile() ? 1 : 0;
  }
  return count;
}

function collectTextFiles(root: string): Array<{ path: string; content: string }> {
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; content: string }> = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push({ path: relative(root, path), content: readFileSync(path, "utf8") });
    }
  };
  walk(root);
  return files;
}

function userExportFiles(userId: string): string[] {
  if (!existsSync(EXPORT_ROOT)) return [];
  const prefix = `${digest(userId, 12)}-`;
  return readdirSync(EXPORT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => join(EXPORT_ROOT, entry.name));
}

function userBackupFiles(): string[] {
  const dbPath = store.getDatabasePath();
  if (dbPath === ":memory:") return [];
  const extension = extname(dbPath) || ".sqlite";
  const prefix = `${basename(dbPath, extname(dbPath))}.v`;
  const directory = dirname(dbPath);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.includes(`.bak${extension}`))
    .map((entry) => join(directory, entry.name));
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function clearDatabaseRows(db: Database.Database, userId: string): void {
  const tables = ["user_profiles", "kitchen_profiles", "ingredient_inventory", "meal_logs", "meal_operations", "web_write_operations", "chat_operations", "weekly_plan_day_status", "cooking_feedback", "weekly_plans", "meal_plans"];
  const clear = db.transaction(() => {
    for (const table of [...SHOPPING_TABLES, ...tables]) {
      if (tableExists(db, table)) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    // agent trace 只有元数据，但同属用户数据，删除时一并清掉；
    // 迁移备份可能来自 v17 之前的旧库，先探测表是否存在。
    if (tableExists(db, "agent_traces")) {
      if (tableExists(db, "agent_trace_spans")) {
        db.prepare("DELETE FROM agent_trace_spans WHERE trace_id IN (SELECT trace_id FROM agent_traces WHERE user_id = ?)").run(userId);
      }
      db.prepare("DELETE FROM agent_traces WHERE user_id = ?").run(userId);
    }
  });
  clear();
}

export interface UserDataOverview {
  database: Record<string, number>;
  sessionFiles: number;
  exportFiles: number;
  requestLogFiles: number;
  migrationBackups: number;
}

export function getUserDataOverview(userId: string): UserDataOverview {
  const db = store.getDatabase();
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).get(userId) as { count: number }).count;
  const sessionDir = join(SESSION_ROOT, digest(userId));
  const logDir = join(LOG_ROOT, digest(userId));
  return {
    database: {
      profile: count("user_profiles"), kitchen: count("kitchen_profiles"), inventory: count("ingredient_inventory"),
      shoppingTasks: count("shopping_tasks"), shoppingReceipts: count("shopping_receipts"), shoppingEvents: count("shopping_events"), shoppingProviderSettings: count("shopping_provider_settings"), shoppingCandidates: count("shopping_candidates"), shoppingProviderChecks: count("shopping_provider_checks"), cartExperiments:count("shopping_cart_experiments"),
      meals: count("meal_logs"), mealOperations: count("meal_operations"), webWriteOperations: count("web_write_operations"), chatOperations: count("chat_operations"), feedback: count("cooking_feedback"), weeklyPlans: count("weekly_plans"), mealPlans: count("meal_plans"),
      agentTraces: tableExists(db, "agent_traces") ? count("agent_traces") : 0,
    },
    sessionFiles: countFiles(sessionDir),
    exportFiles: userExportFiles(userId).length,
    requestLogFiles: countFiles(logDir),
    migrationBackups: userBackupFiles().length,
  };
}

export function exportUserData(userId: string, transcript: readonly ConversationExportEntry[]): string {
  const db = store.getDatabase();
  const weeklyPlans = db.prepare("SELECT week_start_date, days_json, status, created_at, updated_at FROM weekly_plans WHERE user_id = ? ORDER BY week_start_date").all(userId);
  const mealPlans = db.prepare("SELECT start_date, days_json, target, goal, constraints_json, created_at, updated_at FROM meal_plans WHERE user_id = ? ORDER BY start_date").all(userId);
  const mealOperations = db.prepare("SELECT operation_id, action, meal_log_id, result_json, created_at FROM meal_operations WHERE user_id = ? ORDER BY created_at").all(userId);
  const webWriteOperations = db.prepare("SELECT route, operation_id, request_hash, result_json, created_at FROM web_write_operations WHERE user_id = ? ORDER BY created_at").all(userId);
  const chatOperations = db.prepare("SELECT operation_id, message_hash, state, terminal_event_json, created_at, updated_at FROM chat_operations WHERE user_id = ? ORDER BY created_at").all(userId);
  // agent trace 只含元数据（耗时/token/状态），导出用于核对使用量与成本。
  const agentTraces = tableExists(db, "agent_traces")
    ? db.prepare("SELECT entry, status, error_kind, started_at, duration_ms, first_token_ms, attempts, final_model, llm_calls, tool_calls, tool_errors, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd FROM agent_traces WHERE user_id = ? ORDER BY started_at").all(userId)
    : [];
  const agentTraceSpans = agentTraces.length > 0 && tableExists(db, "agent_trace_spans")
    ? db.prepare(`SELECT s.attempt, s.kind, s.name, s.started_at, s.duration_ms, s.status, s.input_tokens, s.output_tokens, s.cache_read_tokens
        FROM agent_trace_spans s JOIN agent_traces t ON t.trace_id = s.trace_id
        WHERE t.user_id = ? ORDER BY s.started_at`).all(userId)
    : [];
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    userId,
    database: {
      profile: store.getUserProfile(userId) ?? null,
      kitchen: store.getKitchenProfile(userId),
      inventory: store.getIngredientInventory(userId),
      meals: store.getAllMealLogs(userId),
      mealOperations,
      webWriteOperations,
      chatOperations,
      agentTraces,
      agentTraceSpans,
      cookingFeedback: store.getCookingFeedback(userId),
      weeklyPlans,
      mealPlans,
      shopping: Object.fromEntries(SHOPPING_TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId)])),
    },
    currentConversation: [...transcript],
    sessionFiles: collectTextFiles(join(SESSION_ROOT, digest(userId))),
    requestLogs: collectTextFiles(join(LOG_ROOT, digest(userId))),
  };
  mkdirSync(EXPORT_ROOT, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = join(EXPORT_ROOT, `${digest(userId, 12)}-${timestamp}.json`);
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return output;
}

export interface UserDataDeletionResult {
  databaseRows: number;
  sessionFiles: number;
  exportFiles: number;
  requestLogFiles: number;
  backupsScrubbed: number;
  backupErrors: number;
}

export function deleteUserData(userId: string, closeAgentSession: () => void): UserDataDeletionResult {
  const overview = getUserDataOverview(userId);
  const db = store.getDatabase();
  const databaseRows = Object.values(overview.database).reduce((sum, value) => sum + value, 0);
  store.clearUserData(userId);

  let backupsScrubbed = 0;
  let backupErrors = 0;
  for (const path of userBackupFiles()) {
    let backup: Database.Database | undefined;
    try {
      backup = new Database(path);
      clearDatabaseRows(backup, userId);
      backup.pragma("wal_checkpoint(TRUNCATE)");
      backup.exec("VACUUM");
      backupsScrubbed += 1;
    } catch {
      backupErrors += 1;
    } finally {
      backup?.close();
    }
  }

  closeAgentSession();
  rmSync(join(SESSION_ROOT, digest(userId)), { recursive: true, force: true });
  const exports = userExportFiles(userId);
  for (const path of exports) unlinkSync(path);
  const logDir = join(LOG_ROOT, digest(userId));
  rmSync(logDir, { recursive: true, force: true });
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  return {
    databaseRows,
    sessionFiles: overview.sessionFiles,
    exportFiles: exports.length,
    requestLogFiles: overview.requestLogFiles,
    backupsScrubbed,
    backupErrors,
  };
}

export function getBackupRetentionPolicy(): string {
  return `数据库迁移备份最多保留 ${BACKUP_RETENTION_MAX} 份，单份最多保留 ${BACKUP_RETENTION_DAYS} 天；删除用户数据时会从现存迁移备份中清除此用户的数据库记录。`;
}
