import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations/index.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(moduleDir, "..", "..", "data");
const databasePath = process.env.DIET_AGENT_DB_PATH || join(defaultDataDir, "diet-agent.sqlite");

let database: Database.Database | undefined;

export function getDatabasePath(): string {
  return databasePath;
}

export function getDatabase(): Database.Database {
  if (database) return database;
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
