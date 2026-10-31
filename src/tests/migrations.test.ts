import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "../store/migrations/index.js";

const temporaryDirectories: string[] = [];

/** v17 形态的 agent_traces（真实 v17+ 库都有；v20 会重建它放宽 entry CHECK）。 */
function createLegacyAgentTraces(db: Database.Database, checkEntries = "'web','tui','eval'"): void {
  db.exec(`CREATE TABLE agent_traces (
    trace_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    operation_id TEXT,
    session_id TEXT,
    entry TEXT NOT NULL CHECK(entry IN (${checkEntries})),
    status TEXT NOT NULL CHECK(status IN
      ('running','ok','verification_required','failed','timeout','budget_exceeded','interrupted')),
    error_kind TEXT,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    first_token_ms INTEGER,
    attempts INTEGER NOT NULL DEFAULT 1,
    final_model TEXT,
    llm_calls INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    tool_errors INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost_usd REAL
  )`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// 含文件库迁移与备份复制，慢速 Windows runner 上单独放宽超时
describe("SQLite 版本化迁移", { timeout: 15_000 }, () => {
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

  it("v18 重算存量菜谱过敏原标签，消除反向子串误报", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 17");
    createLegacyAgentTraces(db);
    // 手工建 v17 形态的 recipe_book 并插入一条带旧规则误报（葱→小麦、糖→牛奶）的记录
    db.exec(`CREATE TABLE recipe_book (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
      ingredients_json TEXT NOT NULL, optional_ingredients_json TEXT NOT NULL DEFAULT '[]',
      cookware_json TEXT NOT NULL, active_minutes INTEGER NOT NULL, total_minutes INTEGER NOT NULL,
      steps_json TEXT NOT NULL, low_energy_swap TEXT, updated_at TEXT NOT NULL
    )`);
    db.prepare(`INSERT INTO recipe_book (id, name, mode, ingredients_json, cookware_json, active_minutes, total_minutes, steps_json, updated_at)
      VALUES ('r1', '葱花炒蛋', 'quick', '["鸡蛋","葱","糖"]', '[]', 5, 10, '[]', 'x')`).run();
    db.exec("ALTER TABLE recipe_book ADD COLUMN vegetables_json TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE recipe_book ADD COLUMN staples_json TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE recipe_book ADD COLUMN primary_protein TEXT");
    db.exec("ALTER TABLE recipe_book ADD COLUMN allergen_tags_json TEXT");

    const result = runMigrations(db, ":memory:");
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    const row = db.prepare("SELECT allergen_tags_json FROM recipe_book WHERE id = 'r1'").get() as { allergen_tags_json: string };
    const tags = JSON.parse(row.allergen_tags_json);
    expect(tags).toEqual(["egg"]); // 葱≠小麦、糖≠牛奶，只剩鸡蛋
    db.close();
  });

  it("v19 分类表新增咖喱块后重算存量过敏原标签", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 18");
    createLegacyAgentTraces(db);
    // 手工建 v18 形态的 recipe_book 并插入一条含咖喱块的记录（v18 时解析不出过敏原）
    db.exec(`CREATE TABLE recipe_book (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
      ingredients_json TEXT NOT NULL, optional_ingredients_json TEXT NOT NULL DEFAULT '[]',
      cookware_json TEXT NOT NULL, active_minutes INTEGER NOT NULL, total_minutes INTEGER NOT NULL,
      steps_json TEXT NOT NULL, low_energy_swap TEXT, updated_at TEXT NOT NULL
    )`);
    db.prepare(`INSERT INTO recipe_book (id, name, mode, ingredients_json, cookware_json, active_minutes, total_minutes, steps_json, updated_at)
      VALUES ('r1', '咖喱鸡块', 'quick', '["鸡腿","咖喱块","土豆"]', '[]', 10, 25, '[]', 'x')`).run();
    db.exec("ALTER TABLE recipe_book ADD COLUMN vegetables_json TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE recipe_book ADD COLUMN staples_json TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE recipe_book ADD COLUMN primary_protein TEXT");
    db.exec("ALTER TABLE recipe_book ADD COLUMN allergen_tags_json TEXT");

    const result = runMigrations(db, ":memory:");
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    const row = db.prepare("SELECT allergen_tags_json FROM recipe_book WHERE id = 'r1'").get() as { allergen_tags_json: string };
    // 咖喱块以面粉为基底：小麦/麸质补上；牛奶品牌非必含，不标
    expect(JSON.parse(row.allergen_tags_json)).toEqual(["gluten", "wheat"]);
    db.close();
  });

  it("v20 agent_traces 的 entry 增加 bench 类型，重建后保留既有行", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 19");
    // 手工建 v17/v19 形态的 agent_traces（旧 CHECK 只有 web/tui/eval）并插入一条既有记录
    createLegacyAgentTraces(db);
    db.prepare(`INSERT INTO agent_traces (trace_id, user_id, entry, status, started_at, attempts)
      VALUES ('t1', 'u1', 'web', 'ok', 123, 1)`).run();
    // 旧 CHECK 下 bench 会被拒绝——迁移要放开的就是这条约束
    expect(() => db.prepare(`INSERT INTO agent_traces (trace_id, user_id, entry, status, started_at, attempts)
      VALUES ('t2', 'u1', 'bench', 'ok', 124, 1)`).run()).toThrow();

    const result = runMigrations(db, ":memory:");
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    // 既有行保留
    const legacy = db.prepare("SELECT entry, status FROM agent_traces WHERE trace_id = 't1'").get();
    expect(legacy).toEqual({ entry: "web", status: "ok" });
    // 新 CHECK 允许 bench
    db.prepare(`INSERT INTO agent_traces (trace_id, user_id, entry, status, started_at, attempts)
      VALUES ('t3', 'u1', 'bench', 'ok', 125, 1)`).run();
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_traces").get()).toEqual({ count: 2 });
    db.close();
  });

  it("拒绝打开比应用更新的数据库", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(db, ":memory:")).toThrow("高于当前支持版本");
    db.close();
  });
});
