/**
 * household_members 表访问守卫：
 * 表的 SQL 访问只允许出现在仓储 householdMemberRepository.ts（唯一事实源）。
 * 业务侧必须走 store facade 或 resolveDiningMembers（services/household.ts，
 * PR C 落地后追加"排菜/过滤路径只经 resolveDiningMembers 取成员"的断言），
 * 防止各处散落直查漏掉"我"的虚拟成员投影，导致过滤口径不一致。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

const TABLE_PATTERN = /household_members/;

describe("household_members 表访问守卫", () => {
  it("除仓储与迁移外，源码不得直接引用 household_members 表", () => {
    const allowed = new Set([
      // 唯一 SQL 访问点（成员数据的事实源）
      join("store", "repositories", "householdMemberRepository.ts"),
      // 建表与索引所在（DDL）
      join("store", "migrations", "index.ts"),
      // 数据清理路径按表名清空各表（与 meal_plans 等同列的既有模式）
      join("privacy", "userData.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      if (file.includes(join("src", "tests"))) continue; // 测试自身不扫
      const relative = file.slice(srcRoot.length + 1);
      if (allowed.has(relative)) continue;
      if (TABLE_PATTERN.test(readFileSync(file, "utf-8"))) offenders.push(relative);
    }
    expect(offenders, `这些文件直接引用了 household_members 表：${offenders.join("、")}`).toEqual([]);
  });
});
