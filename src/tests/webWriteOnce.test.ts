import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../store/migrations/index.js";
import { executeWebWriteOnce, WebWriteConflictError } from "../web/writeOnce.js";

describe("Web 写入去重", () => {
  it("同一操作重启后返回原结果，不再执行写入", () => {
    const directory = mkdtempSync(join(tmpdir(), "diet-web-write-"));
    const path = join(directory, "data.sqlite");
    try {
      let db = new Database(path);
      runMigrations(db, path);
      const payload = { operationId: "same-operation-123", value: "番茄" };
      const first = executeWebWriteOnce(db, "user-a", "/api/inventory/items", payload, () => {
        db.prepare("INSERT INTO ingredient_inventory (user_id, available_ingredients_json, shopping_list_json, updated_at) VALUES (?, ?, '[]', ?)")
          .run("user-a", '[{"name":"番茄"}]', "2026-09-26T00:00:00.000Z");
        return { saved: true, item: "番茄" };
      });
      db.close();

      db = new Database(path);
      runMigrations(db, path);
      const repeated = executeWebWriteOnce(db, "user-a", "/api/inventory/items", { value: "番茄", operationId: "same-operation-123" }, () => {
        throw new Error("不应再次执行写入");
      });
      expect(repeated).toEqual(first);
      expect((db.prepare("SELECT COUNT(*) AS count FROM ingredient_inventory").get() as { count: number }).count).toBe(1);
      expect(() => executeWebWriteOnce(db, "user-a", "/api/inventory/items", {
        operationId: "same-operation-123", value: "鸡蛋",
      }, () => ({ saved: true }))).toThrow(WebWriteConflictError);
      expect(() => executeWebWriteOnce(db, "user-a", "/api/inventory/items", { value: "番茄" }, () => true))
        .toThrow("operationId");
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("写入失败时回滚业务数据和操作记录", () => {
    const db = new Database(":memory:");
    runMigrations(db, ":memory:");
    const payload = { operationId: "failed-operation-123" };
    expect(() => executeWebWriteOnce(db, "user-a", "/api/profile", payload, () => {
      db.prepare("INSERT INTO user_profiles (user_id, avoid_foods_json, preferences_json, allergies_json, medical_notes_json, created_at, updated_at) VALUES (?, '[]', '[]', '[]', '[]', ?, ?)")
        .run("user-a", "now", "now");
      throw new Error("failure");
    })).toThrow("failure");
    expect((db.prepare("SELECT COUNT(*) AS count FROM user_profiles").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS count FROM web_write_operations").get() as { count: number }).count).toBe(0);
    db.close();
  });
});
