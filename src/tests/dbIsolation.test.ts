/**
 * 测试数据库隔离守卫（全局兜底的行为验证）：
 *  - vitest 全局 setup 已设 DIET_AGENT_TEST_DB_GUARD=1 与默认 :memory:；
 *  - assertTestDatabaseIsolation 拒绝项目内真实库路径，放行 :memory: 与临时目录；
 *  - 运行时（守卫未开启）不受影响。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// 静态导入触发 database.ts 模块加载：此时 setup 设的 :memory: 必须已生效。
import { assertTestDatabaseIsolation, getDatabasePath } from "../store/database.js";

describe("测试数据库隔离守卫", () => {
  it("全局 setup 生效：模块加载时的数据库路径是 :memory:", () => {
    expect(process.env.DIET_AGENT_TEST_DB_GUARD).toBe("1");
    expect(getDatabasePath()).toBe(":memory:");
  });

  it("放行 :memory: 与 os.tmpdir() 下的临时文件库", () => {
    expect(() => assertTestDatabaseIsolation(":memory:")).not.toThrow();
    const temporary = mkdtempSync(join(tmpdir(), "diet-guard-"));
    expect(() => assertTestDatabaseIsolation(join(temporary, "t.sqlite"))).not.toThrow();
  });

  it("拒绝项目 data/ 下的真实数据库（绝对与相对路径）", () => {
    expect(() => assertTestDatabaseIsolation(resolve("data/diet-agent.sqlite"))).toThrow("禁止打开真实数据库");
    expect(() => assertTestDatabaseIsolation("data/diet-agent.sqlite")).toThrow("禁止打开真实数据库");
    expect(() => assertTestDatabaseIsolation("D:/elsewhere/real.sqlite")).toThrow("禁止打开真实数据库");
  });

  it("守卫未开启时（正常运行时语义）不拦截", () => {
    const previous = process.env.DIET_AGENT_TEST_DB_GUARD;
    delete process.env.DIET_AGENT_TEST_DB_GUARD;
    try {
      expect(() => assertTestDatabaseIsolation(resolve("data/diet-agent.sqlite"))).not.toThrow();
    } finally {
      process.env.DIET_AGENT_TEST_DB_GUARD = previous;
    }
  });
});
