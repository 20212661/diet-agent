/**
 * 固定回放基准：npm run bench（= tsx scripts/run-bench.ts --live）
 *
 * 用 BENCH_CONVERSATIONS 的 25 段日常多轮对话（记餐/晚饭计划/入库/
 * 查库存/周计划/反馈，按日常比例）以固定种子重放完整 Agent 流程：
 * - 内存库 + 独立合成用户，每段对话前按 setup 重建画像与库存；
 * - entry=bench 与日常流量分开统计（trace:report 默认排除 eval+bench）；
 * - 每轮串行执行，一轮一条 trace，跑完从内存库聚合指标。
 *
 * 用途是"改动前 vs 改动后"对比（如把动态记忆移出 system prompt）：
 * 工作负载固定，缓存命中率、首 token 延迟前后才可比。改一次跑一次，
 * 结果文件带 git commit、模型与日期。评测消耗真实 API 配额，不进 CI。
 *
 * 每轮额外记录 toolCalls（名称+结果码）、回复原文（合成数据，可存）
 * 与 session 重建（相邻两轮 sessionId 变化）——诊断"口头答应但没调
 * 工具"与"写后重建 session"两类问题，指标统计仍以 trace 为准。
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_CONVERSATIONS } from "../src/eval/benchConversations.js";

// 严格参数校验：任何未知参数直接报错。
{
  const rawArgs = process.argv.slice(2);
  for (const arg of rawArgs) {
    if (arg === "--live") continue;
    throw new Error(`未知参数：${arg}。唯一支持的参数：--live（调用真实模型）。`);
  }
}
if (!process.argv.includes("--live")) {
  throw new Error("回放基准调用真实模型。请用 `npm run bench` 运行。");
}

const gitCommit = (() => {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return "unknown";
  }
})();

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../src/store/index.js");
const agentModule = await import("../src/agent/createDietAgent.js");
const {
  sendDietAgentMessage,
  clearUserAgentSession,
  disposeAllAgentSessions,
  getSessionResolutionCounts,
  resetSessionResolutionCounts,
} = agentModule;
const { resolveModelCandidates } = await import("../src/agent/modelAdapter.js");
const { getTraceWindow } = await import("../src/store/repositories/traceRepository.js");

const candidates = resolveModelCandidates().filter((model) => model.provider !== "sdk-default");
if (candidates.length === 0) {
  throw new Error("未配置任何模型 API key。请先在 .env 配置并运行 npm run doctor。");
}

interface ToolCallStatus {
  name: string;
  phase: "pending" | "success" | "error";
  outcome?: string;
}

interface TurnRun {
  turn: number;
  ok: boolean;
  error?: string;
  /** 回复原文：bench 用户全是合成数据，可存，用于诊断"口头答应但没调工具"类问题。 */
  reply?: string;
  /** 本轮工具调用生命周期（名称 + 结果码）。 */
  toolCalls?: ToolCallStatus[];
  /** 本轮所属 session（restoreSessionManager 复用会话文件时可能跨重建不变，只作参考）。 */
  sessionId?: string;
  /** getOrCreateSession 判定结果（created_fresh/reused_unchanged/reused_streaming/rebuilt_*）。 */
  sessionResolution?: string;
  /** 权威重建判定：来自 getOrCreateSession 重建分支的计数器增量。 */
  rebuiltSession?: boolean;
}

interface ConversationRun {
  id: string;
  category: string;
  turns: TurnRun[];
}

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const benchStartedAt = Date.now();
const runs: ConversationRun[] = [];

function setupConversation(userId: string, setup: { allergies?: string[]; avoidFoods?: string[]; availableIngredients?: string[] }): void {
  store.clearUserData(userId);
  store.upsertUserProfile(userId, { allergies: setup.allergies ?? [], avoidFoods: setup.avoidFoods ?? [] });
  if (setup.availableIngredients && setup.availableIngredients.length > 0) {
    store.upsertIngredientInventory(userId, {
      availableIngredients: setup.availableIngredients.map((name) => ({ name, status: "available" as const })),
      replaceAvailable: true,
    });
  }
  store.upsertKitchenProfile(userId, {
    burners: 2, hasOven: true, hasMicrowave: false, hasRiceCooker: false,
    cookware: ["炒锅", "汤锅"], maxActiveMinutes: 20, maxTotalMinutes: 35,
    tastePreferences: [], cookingPreferences: [],
  });
}

try {
  resetSessionResolutionCounts();
  for (const conversation of BENCH_CONVERSATIONS) {
    setupConversation(conversation.userId, conversation.setup);
    const turnRuns: TurnRun[] = [];
    for (let index = 0; index < conversation.turns.length; index++) {
      const toolCalls: ToolCallStatus[] = [];
      const countsBefore = new Map(getSessionResolutionCounts());
      let resolution: string | undefined;
      try {
        const result = await sendDietAgentMessage(conversation.userId, conversation.turns[index]!, {
          entry: "bench",
          onToolStatus: (status) => {
            toolCalls.push({ name: status.toolName, phase: status.phase, outcome: status.outcome });
          },
        });
        // 权威重建判定：直接读 getOrCreateSession 重建分支的计数器增量。
        // sessionId 与 [MODEL] 日志都不可靠（restoreSessionManager 复用会话文件时 sessionId 可能不变）。
        const delta = [...getSessionResolutionCounts()].filter(([kind, count]) => (countsBefore.get(kind) ?? 0) !== count);
        resolution = delta.map(([kind]) => kind).join("+");
        turnRuns.push({
          turn: index + 1,
          ok: true,
          reply: result.reply,
          toolCalls,
          sessionId: result.sessionId,
          sessionResolution: resolution,
          rebuiltSession: delta.some(([kind]) => kind === "rebuilt_memory" || kind === "rebuilt_model"),
        });
      } catch (error) {
        turnRuns.push({
          turn: index + 1,
          ok: false,
          error: error instanceof Error ? error.name : typeof error,
          toolCalls,
          sessionResolution: resolution,
        });
      }
    }
    runs.push({ id: conversation.id, category: conversation.category, turns: turnRuns });
    const toolCount = turnRuns.reduce((acc, turn) => acc + (turn.toolCalls?.filter((call) => call.phase !== "pending").length ?? 0), 0);
    const rebuilds = turnRuns.filter((turn) => turn.rebuiltSession).length;
    console.log(`▶ ${conversation.id}（${conversation.category}）：${turnRuns.filter((turn) => turn.ok).length}/${turnRuns.length} 轮成功 · 工具 ${toolCount} 次 · session 重建 ${rebuilds}${rebuilds > 0 ? "（" + turnRuns.filter((turn) => turn.rebuiltSession).map((turn) => `轮${turn.turn}:${turn.sessionResolution}`).join("、") + "）" : ""}`);
    clearUserAgentSession(conversation.userId);
  }
} finally {
  disposeAllAgentSessions();
}

// 指标一律取自 trace（entry=bench）：一轮请求一条记录，口径与 trace:report 一致。
const traceRows = getTraceWindow(store.getDatabase(), benchStartedAt - 1_000, ["bench"]);
store.closeDatabase();

const total = traceRows.length;
const byStatus = new Map<string, number>();
for (const row of traceRows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
const okCount = byStatus.get("ok") ?? 0;

function percentile(sortedValues: number[], p: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

const durations = [...traceRows.map((row) => row.duration_ms ?? 0).filter((value) => value > 0)].sort((a, b) => a - b);
const firstTokens = [...traceRows.map((row) => row.first_token_ms ?? 0).filter((value) => value > 0)].sort((a, b) => a - b);
const tokenRows = traceRows.filter((row) => row.input_tokens !== null);
const sumField = (pick: (row: (typeof traceRows)[number]) => number | null) =>
  traceRows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);
const inputTokens = sumField((row) => row.input_tokens);
const cacheRead = sumField((row) => row.cache_read_tokens);
const cacheDenominator = inputTokens + cacheRead;

const summary = {
  conversations: BENCH_CONVERSATIONS.length,
  turnsPlanned: BENCH_CONVERSATIONS.reduce((acc, conversation) => acc + conversation.turns.length, 0),
  turnErrors: runs.flatMap((run) => run.turns).filter((turn) => !turn.ok).length,
  turnsWithToolCalls: runs.flatMap((run) => run.turns).filter((turn) => (turn.toolCalls?.length ?? 0) > 0).length,
  sessionRebuilds: runs.flatMap((run) => run.turns).filter((turn) => turn.rebuiltSession === true).length,
  sessionResolutions: Object.fromEntries([...getSessionResolutionCounts()].map(([kind, count]) => [kind, count])),
  traces: total,
  statusBreakdown: Object.fromEntries([...byStatus.entries()].sort()),
  successRate: total > 0 ? Math.round((okCount / total) * 1000) / 1000 : 0,
  fallbackTraces: traceRows.filter((row) => row.attempts > 1).length,
  requestMs: {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
  },
  firstTokenMs: { p50: percentile(firstTokens, 50) },
  avgInputTokens: tokenRows.length > 0 ? Math.round(inputTokens / tokenRows.length) : undefined,
  avgCacheReadTokens: tokenRows.length > 0 ? Math.round(cacheRead / tokenRows.length) : undefined,
  cacheHitRate: cacheDenominator > 0 ? Math.round((1000 * cacheRead) / cacheDenominator) / 1000 : undefined,
  avgToolCalls: total > 0 ? Math.round((sumField((row) => row.tool_calls) / total) * 10) / 10 : undefined,
};

const output = {
  suite: "fixed replay bench (entry=bench)",
  runId,
  date: new Date().toISOString(),
  gitCommit,
  modelCandidates: candidates.map((model) => model.label),
  wallClockMs: Date.now() - benchStartedAt,
  summary,
  runs,
};
const resultDir = join(process.cwd(), "data", "eval-results");
mkdirSync(resultDir, { recursive: true });
const resultFile = join(resultDir, `bench-${runId}.json`);
writeFileSync(resultFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

const ms = (value: number | undefined) => (value === undefined ? "-" : `${(value / 1000).toFixed(2)}s`);
console.log(`\n📊 回放基准：${summary.conversations} 段 / ${summary.traces} 轮请求`);
console.log(`  成功率=${(summary.successRate * 100).toFixed(1)}%  降级=${summary.fallbackTraces}  平均工具调用=${summary.avgToolCalls ?? "-"}  调工具轮数=${summary.turnsWithToolCalls}/${summary.turnsPlanned}  session 重建=${summary.sessionRebuilds}`);
console.log(`  请求耗时 p50=${ms(summary.requestMs.p50)}  p95=${ms(summary.requestMs.p95)}  首 token p50=${ms(summary.firstTokenMs.p50)}`);
console.log(`  平均 input=${summary.avgInputTokens ?? "-"}  平均 cacheRead=${summary.avgCacheReadTokens ?? "-"}  缓存命中率=${summary.cacheHitRate === undefined ? "-" : `${(summary.cacheHitRate * 100).toFixed(1)}%`}`);
console.log(`结果已写入 ${resultFile}`);

// 基准本身硬失败的条件：请求级错误超过 10% 说明环境有问题，数字不可用。
if (summary.turnErrors > summary.turnsPlanned * 0.1 || (total > 0 && okCount / total < 0.9)) {
  process.exitCode = 1;
}
