import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "../store/migrations/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite 版本化迁移", () => {
  it("新数据库逐版本迁移并写入 user_version", () => {
    const db = new Database(":memory:");
    const result = runMigrations(db, ":memory:");
    expect(result).toMatchObject({ from: 0, to: CURRENT_SCHEMA_VERSION });
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    expect((db.pragma("table_info(kitchen_profiles)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["has_microwave", "has_rice_cooker"]));
    expect((db.pragma("table_info(meal_logs)") as { name: string }[]).map((column) => column.name)).toContain("deleted_at");
    expect((db.pragma("table_info(weekly_plan_day_status)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["user_id", "week_start_date", "date", "recipe_id", "completed_at"]));
    expect((db.pragma("table_info(web_write_operations)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["user_id", "route", "operation_id", "request_hash", "result_json"]));
    expect((db.pragma("table_info(chat_operations)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["user_id", "operation_id", "message_hash", "state", "terminal_event_json"]));
    db.close();
  });

  it("已有文件升级前生成同目录备份", () => {
    const directory = mkdtempSync(join(tmpdir(), "diet-agent-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "diet.sqlite");
    const db = new Database(path);
    runMigrations(db, path);
    db.pragma("user_version = 2");
    const result = runMigrations(db, path);

    expect(result.from).toBe(2);
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.backupPath).toBeTruthy();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readdirSync(directory).some((name) => name.includes(`v2-to-v${CURRENT_SCHEMA_VERSION}`))).toBe(true);
    const backup = new Database(result.backupPath!, { readonly: true });
    const integrity = backup.pragma("integrity_check", { simple: true });
    const backupVersion = backup.pragma("user_version", { simple: true });
    backup.close();
    expect(integrity).toBe("ok");
    expect(backupVersion).toBe(2);
    db.close();
  });

  it("拒绝打开比应用更新的数据库", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(db, ":memory:")).toThrow("高于当前支持版本");
    db.close();
  });
});
