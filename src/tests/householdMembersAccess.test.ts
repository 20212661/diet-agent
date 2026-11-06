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

/** 匹配对 household_members 表的 SQL 访问（SELECT/INSERT/UPDATE/DELETE/DDL）；
 *  注释里提到表名不算——守卫拦的是绕过仓储直查数据，不是文档。 */
const SQL_ACCESS_PATTERN = /\b(FROM|INTO|UPDATE|TABLE|INDEX)\s+[^\n;]*\bhousehold_members\b/i;

describe("household_members 表访问守卫", () => {
  it("除仓储/迁移/数据清理外，源码不得对 household_members 表发 SQL", () => {
    const allowed = new Set([
      // 唯一 SQL 访问点（成员数据的事实源）
      join("store", "repositories", "householdMemberRepository.ts"),
      // 建表与索引所在（DDL）
      join("store", "migrations", "index.ts"),
      // 数据清理路径按表名清空各表（与 meal_plans 等同列的既有模式）
      join("privacy", "userData.ts"),
      join("store", "repositories", "userDataRepository.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      if (file.includes(join("src", "tests"))) continue; // 测试自身不扫
      const relative = file.slice(srcRoot.length + 1);
      if (allowed.has(relative)) continue;
      if (SQL_ACCESS_PATTERN.test(readFileSync(file, "utf-8"))) offenders.push(relative);
    }
    expect(offenders, `这些文件对 household_members 表发了 SQL：${offenders.join("、")}`).toEqual([]);
  });

  it("成员读取统一入口：排菜/过滤/搜索之外不散落直查，排菜路径只经 resolveDiningMembers", () => {
    // listHouseholdMembers / listDiningMembers 的调用方白名单：
    // 谁可以直接取成员清单（管理/展示/导出/统一入口本身），其余一律违规。
    const allowed = new Set([
      // 定义与统一导出
      join("store", "repositories", "householdMemberRepository.ts"),
      join("store", "sqliteStore.ts"),
      // 统一入口：解析"谁吃"的唯一业务侧实现（内部调用 listHouseholdMembers）
      join("services", "household.ts"),
      // 成员管理工具（增删改查自身的操作对象）
      join("tools", "getHouseholdMembers.ts"),
      join("tools", "upsertHouseholdMember.ts"),
      join("tools", "removeHouseholdMember.ts"),
      // 展示类消费（系统提示注入/dashboard），不做过滤决策
      join("agent", "systemPrompt.ts"),
      join("web", "server.ts"),
      // 数据导出（隐私三件套，非过滤路径）
      join("privacy", "userData.ts"),
      // 仓储层读取重校验：不能反向依赖 services（store→services→store 循环），
      // 用同层的 householdMemberRepository + 纯函数 resolveDiningRefs 重放（含"我"投影）
      join("store", "repositories", "mealPlanRepository.ts"),
      join("store", "repositories", "weeklyPlanRepository.ts"),
    ]);
    const directOffenders: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      if (file.includes(join("src", "tests"))) continue;
      const relative = file.slice(srcRoot.length + 1);
      if (allowed.has(relative)) continue;
      const text = readFileSync(file, "utf-8");
      if (/\blistHouseholdMembers\b|\blistDiningMembers\b/.test(text)) directOffenders.push(relative);
    }
    expect(directOffenders, `这些文件绕过统一入口直取成员清单：${directOffenders.join("、")}`).toEqual([]);

    // 排菜/过滤/搜索的具体路径文件：连引用都不允许（必须经 resolveDiningMembers
    // 或仓储层的 resolveDiningRefs 重放），防止漏掉"我"的虚拟投影导致过滤口径漂移
    const planningPaths = [
      join("tools", "generateMealPlan.ts"),
      join("tools", "generateWeeklyPlan.ts"),
      join("tools", "generateCookingPlan.ts"),
      join("tools", "searchRecipes.ts"),
      join("services", "mealPlanBuilder.ts"),
      join("services", "weeklyPlanService.ts"),
      join("recipes", "recipeMatcher.ts"),
      join("recipes", "executionConstraints.ts"),
      join("recipes", "mealPlanValidation.ts"),
    ].map((path) => join(srcRoot, path));
    const planningOffenders = planningPaths.filter((path) => {
      const text = readFileSync(path, "utf-8");
      return /\blistHouseholdMembers\b|\blistDiningMembers\b|\bselfDiningMember\b/.test(text);
    }).map((path) => path.slice(srcRoot.length + 1));
    expect(planningOffenders, `排菜/过滤/搜索路径必须经 resolveDiningMembers：${planningOffenders.join("、")}`).toEqual([]);
  });
});
