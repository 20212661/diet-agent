import Database from "better-sqlite3";
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, extname, basename, join } from "node:path";

export const CURRENT_SCHEMA_VERSION = 17;

interface Migration {
  version: number;
  description: string;
  up(db: Database.Database): void;
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as { name: string }[];
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnSql: string,
  columnName: string
): void {
  if (!tableHasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY, goal TEXT, custom_goal TEXT, height_cm REAL,
      weight_kg REAL, age INTEGER, gender TEXT, activity_level TEXT,
      avoid_foods_json TEXT NOT NULL DEFAULT '[]', preferences_json TEXT NOT NULL DEFAULT '[]',
      allergies_json TEXT NOT NULL DEFAULT '[]', medical_notes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kitchen_profiles (
      user_id TEXT PRIMARY KEY, burners INTEGER NOT NULL DEFAULT 2,
      has_oven INTEGER NOT NULL DEFAULT 1, cookware_json TEXT NOT NULL DEFAULT '[]',
      max_active_minutes INTEGER NOT NULL DEFAULT 20, max_total_minutes INTEGER NOT NULL DEFAULT 35,
      taste_preferences_json TEXT NOT NULL DEFAULT '[]', cooking_preferences_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ingredient_inventory (
      user_id TEXT PRIMARY KEY, available_ingredients_json TEXT NOT NULL DEFAULT '[]',
      shopping_list_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meal_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, meal_type TEXT NOT NULL,
      foods_json TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(user_id, date);
    CREATE TABLE IF NOT EXISTS cooking_feedback (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, recipe_id TEXT, recipe_name TEXT,
      rating INTEGER, actual_active_minutes INTEGER, actual_total_minutes INTEGER,
      too_tiring INTEGER, too_many_dishes INTEGER, note TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cooking_feedback_user ON cooking_feedback(user_id);
    CREATE TABLE IF NOT EXISTS recipe_book (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
      ingredients_json TEXT NOT NULL, optional_ingredients_json TEXT NOT NULL DEFAULT '[]',
      cookware_json TEXT NOT NULL, active_minutes INTEGER NOT NULL, total_minutes INTEGER NOT NULL,
      steps_json TEXT NOT NULL, low_energy_swap TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_plans (
      user_id TEXT NOT NULL, week_start_date TEXT NOT NULL, days_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, week_start_date)
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_plans_user_status ON weekly_plans(user_id, status);
  `);
}

const migrations: readonly Migration[] = [
  { version: 1, description: "create base tables", up: createBaseSchema },
  {
    version: 2,
    description: "add cooking feedback repeat preference",
    up(db) {
      addColumnIfMissing(db, "cooking_feedback", "would_cook_again INTEGER", "would_cook_again");
    },
  },
  {
    version: 3,
    description: "add complete kitchen appliance fields",
    up(db) {
      addColumnIfMissing(db, "kitchen_profiles", "has_microwave INTEGER NOT NULL DEFAULT 0", "has_microwave");
      addColumnIfMissing(db, "kitchen_profiles", "has_rice_cooker INTEGER NOT NULL DEFAULT 0", "has_rice_cooker");
    },
  },
  {
    version: 4,
    description: "expand structured recipe fields",
    up(db) {
      const table = "recipe_book";
      addColumnIfMissing(db, table, "meal_types_json TEXT NOT NULL DEFAULT '[]'", "meal_types_json");
      addColumnIfMissing(db, table, "modes_json TEXT NOT NULL DEFAULT '[]'", "modes_json");
      addColumnIfMissing(db, table, "suitable_goals_json TEXT NOT NULL DEFAULT '[]'", "suitable_goals_json");
      addColumnIfMissing(db, table, "primary_protein TEXT", "primary_protein");
      addColumnIfMissing(db, table, "vegetables_json TEXT NOT NULL DEFAULT '[]'", "vegetables_json");
      addColumnIfMissing(db, table, "staples_json TEXT NOT NULL DEFAULT '[]'", "staples_json");
      addColumnIfMissing(db, table, "appliances_json TEXT NOT NULL DEFAULT '[]'", "appliances_json");
      addColumnIfMissing(db, table, "difficulty INTEGER NOT NULL DEFAULT 2", "difficulty");
      addColumnIfMissing(db, table, "dish_count INTEGER NOT NULL DEFAULT 2", "dish_count");
      addColumnIfMissing(db, table, "taste_tags_json TEXT NOT NULL DEFAULT '[]'", "taste_tags_json");
      addColumnIfMissing(db, table, "preference_tags_json TEXT NOT NULL DEFAULT '[]'", "preference_tags_json");
      addColumnIfMissing(db, table, "season_tags_json TEXT NOT NULL DEFAULT '[]'", "season_tags_json");
      addColumnIfMissing(db, table, "timeline_json TEXT NOT NULL DEFAULT '[]'", "timeline_json");
      addColumnIfMissing(db, table, "weekend_prep TEXT", "weekend_prep");
      addColumnIfMissing(db, table, "freezer_reuse TEXT", "freezer_reuse");
      addColumnIfMissing(db, table, "estimated_calories INTEGER", "estimated_calories");
      addColumnIfMissing(db, table, "protein_level TEXT", "protein_level");
    },
  },
  {
    version: 5,
    description: "add normalized recipe ingredients and allergen tags",
    up(db) {
      addColumnIfMissing(db, "recipe_book", "ingredient_ids_json TEXT NOT NULL DEFAULT '[]'", "ingredient_ids_json");
      addColumnIfMissing(db, "recipe_book", "allergen_tags_json TEXT NOT NULL DEFAULT '[]'", "allergen_tags_json");
    },
  },
  {
    version: 6,
    description: "add idempotent and editable meal operations",
    up(db) {
      addColumnIfMissing(db, "meal_logs", "operation_id TEXT", "operation_id");
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_logs_user_operation
          ON meal_logs(user_id, operation_id) WHERE operation_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS meal_operations (
          user_id TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          action TEXT NOT NULL,
          meal_log_id TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, operation_id)
        );
      `);
    },
  },
  {
    version: 7,
    description: "store traceable recipe nutrition metadata",
    up(db) {
      addColumnIfMissing(db, "recipe_book", "nutrition_json TEXT", "nutrition_json");
      // Legacy calorie values have no portion, method, source, or release metadata.
      // Keep the column for compatibility, but clear values so downstream code cannot treat them as facts.
      db.exec("UPDATE recipe_book SET estimated_calories = NULL");
    },
  },
  {
    version: 8,
    description: "persist daily meal plans",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meal_plans (
          user_id TEXT NOT NULL,
          start_date TEXT NOT NULL,
          days_json TEXT NOT NULL DEFAULT '[]',
          target TEXT,
          goal TEXT,
          constraints_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, start_date)
        );
        CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, start_date);
      `);
    },
  },
  {
    version: 9,
    description: "persist explicit weekly plan day completion",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS weekly_plan_day_status (
          user_id TEXT NOT NULL,
          week_start_date TEXT NOT NULL,
          date TEXT NOT NULL,
          recipe_id TEXT NOT NULL,
          completed_at TEXT NOT NULL,
          PRIMARY KEY (user_id, week_start_date, date, recipe_id)
        );
        CREATE INDEX IF NOT EXISTS idx_weekly_day_status_plan
          ON weekly_plan_day_status(user_id, week_start_date, date);
      `);
    },
  },
  {
    version: 10,
    description: "soft delete meal logs for recovery",
    up(db) {
      addColumnIfMissing(db, "meal_logs", "deleted_at TEXT", "deleted_at");
      db.exec("CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date_active ON meal_logs(user_id, date, deleted_at)");
    },
  },
  {
    version: 11,
    description: "persist web write operation results",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS web_write_operations (
          user_id TEXT NOT NULL,
          route TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, route, operation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_web_write_operations_created
          ON web_write_operations(created_at);
      `);
    },
  },
  {
    version: 12,
    description: "persist chat request outcomes",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_operations (
          user_id TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          message_hash TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('running', 'done', 'failed_before_write', 'result_uncertain')),
          terminal_event_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, operation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_operations_updated
          ON chat_operations(updated_at);
      `);
    },
  },
  {
    version: 13,
    description: "bind meal operation ids to request content",
    up(db) {
      addColumnIfMissing(db, "meal_operations", "request_hash TEXT", "request_hash");
    },
  },
  {
    version: 14,
    description: "add shopping tasks, receipts and platform settings",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shopping_tasks (
          id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL,
          provider TEXT NOT NULL CHECK(provider IN ('meituan','taobao')),
          items_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(user_id,id)
        );
        CREATE INDEX IF NOT EXISTS idx_shopping_tasks_user ON shopping_tasks(user_id,created_at);
        CREATE TABLE IF NOT EXISTS shopping_receipts (
          user_id TEXT NOT NULL, task_id TEXT NOT NULL, operation_id TEXT NOT NULL,
          request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(user_id,task_id,operation_id),
          FOREIGN KEY(user_id,task_id) REFERENCES shopping_tasks(user_id,id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS shopping_events (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
          type TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(user_id,task_id) REFERENCES shopping_tasks(user_id,id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS shopping_provider_settings (
          user_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('meituan','taobao')),
          url TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(user_id,provider)
        );
      `);
    },
  },
  {
    version: 15,
    description: "官方购物能力核验及短时门店候选缓存",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shopping_provider_checks (
          user_id TEXT NOT NULL, provider TEXT NOT NULL, capability TEXT NOT NULL,
          credential_hash TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL,
          PRIMARY KEY(user_id,provider,capability)
        );
        CREATE TABLE IF NOT EXISTS shopping_candidates (
          user_id TEXT NOT NULL, id TEXT NOT NULL, provider TEXT NOT NULL,
          credential_hash TEXT NOT NULL, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL,
          PRIMARY KEY(user_id,id)
        );
        CREATE INDEX IF NOT EXISTS idx_shopping_candidates_expiry ON shopping_candidates(expires_at);
      `);
    },
  },
  {
    version: 16,
    description: "手机选购实验与购物车核对记录",
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS shopping_cart_experiments (
        user_id TEXT NOT NULL, id TEXT NOT NULL, task_id TEXT NOT NULL,
        status TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id,id),
        FOREIGN KEY(user_id,task_id) REFERENCES shopping_tasks(user_id,id) ON DELETE CASCADE
      ); CREATE INDEX IF NOT EXISTS idx_cart_experiments_user ON shopping_cart_experiments(user_id,updated_at);`);
    },
  },
  {
    version: 17,
    description: "agent 会话追踪（只记元数据，不含提示词/参数/结果内容）",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_traces (
          trace_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          operation_id TEXT,
          session_id TEXT,
          entry TEXT NOT NULL CHECK(entry IN ('web','tui','eval')),
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
        );
        CREATE INDEX IF NOT EXISTS idx_traces_user_time ON agent_traces(user_id, started_at);
        CREATE TABLE IF NOT EXISTS agent_trace_spans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL REFERENCES agent_traces(trace_id) ON DELETE CASCADE,
          attempt INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('llm','tool','retry','fallback','abort')),
          name TEXT,
          started_at INTEGER NOT NULL,
          duration_ms INTEGER,
          status TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cache_read_tokens INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON agent_trace_spans(trace_id);
      `);
    },
  },
];

function containsApplicationTables(db: Database.Database): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN ('user_profiles', 'meal_logs', 'recipe_book')
  `).get() as { count: number };
  return row.count > 0;
}

export function backupDatabaseBeforeMigration(
  db: Database.Database,
  databasePath: string,
  fromVersion: number,
  toVersion: number
): string | undefined {
  if (databasePath === ":memory:" || !existsSync(databasePath) || statSync(databasePath).size === 0) return undefined;
  db.pragma("wal_checkpoint(FULL)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = extname(databasePath) || ".sqlite";
  const stem = basename(databasePath, extension);
  const backupPath = join(dirname(databasePath), `${stem}.v${fromVersion}-to-v${toVersion}.${stamp}.bak${extension}`);
  copyFileSync(databasePath, backupPath);
  return backupPath;
}

export function runMigrations(db: Database.Database, databasePath: string): { from: number; to: number; backupPath?: string } {
  pruneMigrationBackups(databasePath);
  const from = Number(db.pragma("user_version", { simple: true })) || 0;
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${from} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}`);
  }
  if (from === CURRENT_SCHEMA_VERSION) return { from, to: from };

  const shouldBackup = containsApplicationTables(db);
  const backupPath = shouldBackup
    ? backupDatabaseBeforeMigration(db, databasePath, from, CURRENT_SCHEMA_VERSION)
    : undefined;

  for (const migration of migrations) {
    if (migration.version <= from) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
    console.log(`📦 数据库迁移 v${migration.version}: ${migration.description}`);
  }
  pruneMigrationBackups(databasePath);
  return { from, to: CURRENT_SCHEMA_VERSION, backupPath };
}

/** Keep at most three migration snapshots and never retain one beyond 30 days. */
function pruneMigrationBackups(databasePath: string, now = Date.now()): void {
  if (databasePath === ":memory:") return;
  const extension = extname(databasePath) || ".sqlite";
  const stem = basename(databasePath, extname(databasePath));
  const directory = dirname(databasePath);
  if (!existsSync(directory)) return;
  const prefix = `${stem}.v`;
  const backups = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.includes(`.bak${extension}`))
    .map((entry) => join(directory, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const expiresBefore = now - 30 * 24 * 60 * 60 * 1000;
  backups.forEach((path, index) => {
    if (index >= 3 || statSync(path).mtimeMs < expiresBefore) unlinkSync(path);
  });
}
