import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations/index.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(moduleDir, "..", "..", "data");
const databasePath = process.env.DIET_AGENT_DB_PATH || join(defaultDataDir, "diet-agent.sqlite");

let database: Database.Database | undefined;

/**
 * 测试守卫：DIET_AGENT_TEST_DB_GUARD=1（vitest 全局 setup 设置）时，
 * 拒绝打开项目 data/ 下的真实数据库——只放行 :memory: 与 os.tmpdir()
 * 下的临时文件库。防止测试静默连上真实库并对其执行迁移。
 * 导出仅供守卫测试直接断言（见 src/tests/dbIsolation.test.ts）。
 */
export function assertTestDatabaseIsolation(path: string): void {
  if (process.env.DIET_AGENT_TEST_DB_GUARD !== "1") return;
  if (path === ":memory:") return;
  const resolved = isAbsolute(path) ? path : resolve(path);
  if (resolved.startsWith(tmpdir())) return;
  throw new Error(
    `测试环境禁止打开真实数据库：${resolved}。测试请使用 :memory:，` +
      `或把 DIET_AGENT_DB_PATH 指向 ${tmpdir()} 下的临时目录。`
  );
}

export function getDatabasePath(): string {
  return databasePath;
}

export function getDatabase(): Database.Database {
  if (database) return database;
  assertTestDatabaseIsolation(databasePath);
  if (databasePath !== ":memory:") {
    const directory = dirname(databasePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }

  database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  const migration = runMigrations(database, databasePath);
  if (migration.backupPath) console.log(`📦 迁移前备份：${migration.backupPath}`);
  return database;
}

export function closeDatabase(): void {
  if (!database) return;
  database.close();
  database = undefined;
}

getDatabase();
console.log(`📦 SQLite 存储已初始化: ${databasePath}`);
