/**
 * Agent trace 汇总报告：npm run trace:report [-- <days>] [--entry web|tui|eval|all]
 *
 * 输出最近 N 天（默认 7）的稳定性/延迟/成本指标：
 * - 成功率、超时率、降级率、verification_required 率、崩溃（interrupted）次数
 * - 请求耗时与首 token 延迟分位数（SQLite 无百分位函数，取回后在 JS 里算）
 * - 每个工具的调用量与错误率
 * - token 用量、成本与缓存命中率
 *
 * 入口过滤：默认排除 eval（评测流量大，会污染真实使用基线）；
 * `--entry eval` 只看评测，`--entry web` / `--entry tui` 只看单入口，
 * `--entry all` 全部。
 * 缓存命中率尤其值得盯：把动态记忆移出 system prompt 之类的改动，
 * 改动前后对比这一项即可验证效果。
 */
import "dotenv/config";
import * as store from "../src/store/index.js";
import {
  getDailyTraceUsage,
  getToolSpanStats,
  getTraceWindow,
  type TraceWindowRow,
} from "../src/store/repositories/traceRepository.js";

// 严格参数解析：未知参数直接报错，避免"以为改了口径其实没生效"。
const ENTRY_VALUES = ["web", "tui", "eval", "all"] as const;
const rawArgs = process.argv.slice(2);
const positional: string[] = [];
let entryValue: (typeof ENTRY_VALUES)[number] | undefined;
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--entry") {
    const value = rawArgs[++i];
    if (value === undefined || !ENTRY_VALUES.includes(value as (typeof ENTRY_VALUES)[number])) {
      throw new Error(`--entry 可选 ${ENTRY_VALUES.join(" | ")}（收到 ${value}；默认排除 eval）`);
    }
    entryValue = value as (typeof ENTRY_VALUES)[number];
    continue;
  }
  if (arg.startsWith("--")) {
    throw new Error(`未知参数：${arg}。用法：npm run trace:report [-- <days>] [--entry ${ENTRY_VALUES.join("|")}]`);
  }
  positional.push(arg);
}
if (positional.length > 1) throw new Error(`至多一个位置参数（天数），收到：${positional.join(" ")}`);
const days = Math.max(1, Math.floor(Number(positional[0] ?? 7)) || 7);
const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

const entries: readonly string[] | undefined =
  entryValue === "all" ? undefined
    : entryValue === undefined ? ["web", "tui"]
      : [entryValue];
const entryLabel = entries === undefined ? "全部"
  : entries.length === 1 && entries[0] === "eval" ? "仅 eval"
    : `${entries.join("+")}（排除 eval）`;

const db = store.getDatabase();
const rows = getTraceWindow(db, sinceMs, entries);
const toolStats = getToolSpanStats(db, sinceMs, entries);
const dailyUsage = getDailyTraceUsage(db, sinceMs, entries);

const percent = (value: number, total: number) => (total > 0 ? `${(100 * value / total).toFixed(1)}%` : "-");
const ms = (value: number | undefined) => (value === undefined ? "-" : `${(value / 1000).toFixed(2)}s`);

function percentile(sortedValues: number[], p: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function quantiles(values: number[]): { p50?: number; p95?: number; p99?: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
}

const byStatus = new Map<string, number>();
for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
const total = rows.length;
const count = (status: string) => byStatus.get(status) ?? 0;

const fallbacks = rows.filter((row) => row.attempts > 1).length;
const sum = (pick: (row: TraceWindowRow) => number | null) =>
  rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);

const durations = quantiles(rows.map((row) => row.duration_ms ?? 0).filter((value) => value > 0));
const firstTokens = quantiles(rows.map((row) => row.first_token_ms ?? 0).filter((value) => value > 0));

const inputTokens = sum((row) => row.input_tokens);
const outputTokens = sum((row) => row.output_tokens);
const cacheRead = sum((row) => row.cache_read_tokens);
const cacheWrite = sum((row) => row.cache_write_tokens);
const costUsd = sum((row) => row.cost_usd);
const cacheDenominator = inputTokens + cacheRead;
const cacheHitRate = cacheDenominator > 0 ? `${(100 * cacheRead / cacheDenominator).toFixed(1)}%` : "-";

console.log(`\n📊 Agent trace 报告（最近 ${days} 天，${total} 次请求，入口: ${entryLabel}）\n`);

console.log("── 结果分布 ──");
for (const status of ["ok", "verification_required", "timeout", "budget_exceeded", "failed", "interrupted"]) {
  if (count(status) > 0) console.log(`  ${status.padEnd(24)} ${String(count(status)).padStart(6)}  ${percent(count(status), total)}`);
}
if (total === 0) console.log("  （无记录）");
console.log(`  降级请求（attempts>1）      ${String(fallbacks).padStart(6)}  ${percent(fallbacks, total)}`);
console.log(`  平均工具调用               ${total > 0 ? (sum((row) => row.tool_calls) / total).toFixed(1) : "-"}`);

console.log("\n── 延迟 ──");
console.log(`  请求耗时   p50=${ms(durations.p50)}  p95=${ms(durations.p95)}  p99=${ms(durations.p99)}`);
console.log(`  首 token   p50=${ms(firstTokens.p50)}  p95=${ms(firstTokens.p95)}`);

console.log("\n── 工具错误率 ──");
if (toolStats.length === 0) {
  console.log("  （无记录）");
} else {
  for (const stat of toolStats) {
    console.log(`  ${stat.name.padEnd(28)} calls=${String(stat.calls).padStart(5)}  error=${String(stat.errorPct).padStart(5)}%  avg=${ms(stat.avgMs ?? undefined)}`);
  }
}

console.log("\n── Token 与成本 ──");
console.log(`  input=${inputTokens.toLocaleString()}  output=${outputTokens.toLocaleString()}  cacheRead=${cacheRead.toLocaleString()}  cacheWrite=${cacheWrite.toLocaleString()}`);
console.log(`  成本≈$${costUsd.toFixed(4)}  缓存命中率（cacheRead/(input+cacheRead)）=${cacheHitRate}`);

if (dailyUsage.length > 0) {
  console.log("\n── 按天用量 ──");
  for (const day of dailyUsage) {
    console.log(
      `  ${day.day}  请求=${String(day.requests).padStart(4)}  in=${day.inputTokens.toLocaleString()}  out=${day.outputTokens.toLocaleString()}  cacheRead=${day.cacheReadTokens.toLocaleString()}  $${day.costUsd.toFixed(4)}`,
    );
  }
}

console.log(
  `\n提示：AGENT_TURN_TIMEOUT_MS 建议设为实际 p99 耗时的 ~1.5 倍（当前 p99=${ms(durations.p99)}）。\n`,
);
store.closeDatabase();
