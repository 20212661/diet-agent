/**
 * Opt-in black-box evaluation through the configured live model and real AgentSession.
 *
 * 用法（唯一正确的写法，见 README「评测」一节）：
 *   npm run eval:agent                          # 修复开单阶段（产品行为基线）
 *   npm run eval:agent -- --repair-compare      # A 组：同进程先后跑 修复开/修复关 两阶段
 *   DIET_TOOL_REPAIR=off npm run eval:agent     # 单独跑“修复关”对照阶段
 *   可选 --repeat N（默认 3，1-10）；不存在 --tool-repair 之类的参数，
 *   未知参数一律报错退出——防止“以为跑的是修复关，实际是修复开”。
 *
 * LLM 输出有随机性，单次结果不可信：每个场景独立用户重跑多次，
 * 场景级汇总给出通过率与耗时的 平均/最小/最大。结果写入
 * data/eval-results/，带模型名、git commit、日期与重复次数，保证可复现。
 *
 * A 组（参数修复中间件）只比较成功率与参数问题率：两阶段固定先开后关，
 * 第二阶段可能受益于 provider 预热缓存，且修复关阶段失败/重试更多，
 * 延迟与成本不可跨阶段比较。参数问题率来自修复开阶段（X% 的调用存在
 * 格式问题），无需关闭对照即可得到。
 * B 组（模型对比）models[] 按实际响应模型统计请求数、p50/p95 延迟、首
 * token、工具调用与 token 成本——只统计“修复开”阶段窗口（modelsScope
 * 注明口径），避免对照阶段的重试噪声污染模型数据。
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 严格参数校验：任何未知参数直接报错。
{
  const rawArgs = process.argv.slice(2);
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--repeat") {
      if (rawArgs[i + 1] === undefined) throw new Error("--repeat 需要一个 1-10 的整数值。");
      i++;
      continue;
    }
    if (arg === "--live" || arg === "--repair-compare") continue;
    throw new Error(
      `未知参数：${arg}。支持的参数：--live、--repeat <1-10>、--repair-compare；`
      + "单跑“修复关”对照阶段用环境变量 DIET_TOOL_REPAIR=off（没有 --tool-repair 参数）。",
    );
  }
}

if (!process.argv.includes("--live")) {
  throw new Error("This evaluator calls a configured model API. Run it explicitly with `npm run eval:agent`.");
}

const repeatFlagIndex = process.argv.indexOf("--repeat");
const repeat = repeatFlagIndex >= 0 ? Number(process.argv[repeatFlagIndex + 1]) : 3;
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
  throw new Error(`--repeat 需为 1-10 的整数（收到 ${process.argv[repeatFlagIndex + 1]}）。评测调用真实模型，重复次数过高会显著增加费用。`);
}
const gitCommit = (() => {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return "unknown";
  }
})();
// A 组评测开关：DIET_TOOL_REPAIR=off 关闭类型修复做对照（userId/幂等注入保留）。
// --repair-compare 同进程跑 修复开/关 两阶段（开关按调用懒读取，可运行期切换）。
const repairCompare = process.argv.includes("--repair-compare");
const phases: Array<"on" | "off"> = repairCompare
  ? ["on", "off"]
  : [process.env.DIET_TOOL_REPAIR === "off" ? "off" : "on"];

process.env.DIET_AGENT_DB_PATH = ":memory:";

const [store, agentModule, storeDate, safety] = await Promise.all([
  import("../src/store/index.js"),
  import("../src/agent/createDietAgent.js"),
  import("../src/store/shared.js"),
  import("../src/recipes/foodSafety.js"),
]);
const { sendDietAgentMessage, clearUserAgentSession, disposeAllAgentSessions } = agentModule;
const { todayDate } = storeDate;
const { startToolRepairRecording, stopToolRepairRecording } = await import("../src/agent/toolRepairTelemetry.js");
import type { ToolRepairTelemetrySummary } from "../src/agent/toolRepairTelemetry.js";
const { resolveModelCandidates } = await import("../src/agent/modelAdapter.js");
const configuredModels = resolveModelCandidates().filter((model) => model.provider !== "sdk-default");
if (configuredModels.length === 0) throw new Error("No configured model candidates. Add a supported model API key to .env and check `npm run doctor`.");

interface TurnSpec {
  message: string;
  userScope?: "primary" | "other";
  requiredTools?: string[];
  forbiddenTools?: string[];
  expectedMealLogDelta?: number;
  expectPlanSaved?: boolean;
  check?: (userId: string, reply: string) => string[];
}
interface Scenario {
  id: string;
  setup: (userId: string, otherUserId: string) => void;
  turns: TurnSpec[];
}
interface TurnReport {
  toolCalls: string[];
  mealLogDelta: number;
  planSaved: boolean;
  requiredToolsMissing: string[];
  forbiddenToolsUsed: string[];
  toolErrors: string[];
  failures: string[];
  durationMs: number;
}
interface RunReport {
  run: number;
  turns: TurnReport[];
  passed: boolean;
  durationMs: number;
}
interface MetricTriple {
  avg: number;
  min: number;
  max: number;
}
interface ScenarioReport {
  id: string;
  runs: RunReport[];
  /** 所有重复都通过才算整场景通过。 */
  passed: boolean;
  aggregate: {
    passedRuns: number;
    runCount: number;
    passRate: number;
    runMs: MetricTriple;
    toolCalls: number;
    toolErrors: number;
    /** tool_execution_end 非 error 占比；agent 级错误不计入分母内失败。 */
    toolCallSuccessRate: number | null;
    forbiddenToolCalls: number;
    stateOrSafetyFailures: number;
  };
}

function metricTriple(values: number[]): MetricTriple {
  if (values.length === 0) return { avg: 0, min: 0, max: 0 };
  const sum = values.reduce((acc, value) => acc + value, 0);
  return { avg: Math.round(sum / values.length), min: Math.min(...values), max: Math.max(...values) };
}

const date = todayDate();
const scenarios: Scenario[] = [
  {
    id: "explicit_meal_logging",
    setup: () => {},
    turns: [{
      message: "请记录我今天的午餐：米饭一碗，西红柿炒鸡蛋一份。",
      requiredTools: ["log_meal"],
      expectedMealLogDelta: 1,
      check: (userId) => store.getAllMealLogs(userId).length === 1 ? [] : ["明确记录请求没有产生一条餐食记录"],
    }],
  },
  {
    id: "casual_breakfast_multi_food",
    setup: () => {},
    turns: [{
      message: "我早餐吃了燕麦粥和一个煮鸡蛋",
      requiredTools: ["log_meal"],
      expectedMealLogDelta: 1,
      check: (userId) => {
        const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
        return ["燕麦粥", "鸡蛋"].filter((expected) => !names.includes(expected))
          .map((expected) => `口语化多食物记餐缺了 ${expected}（已记：${names || "无"}）`);
      },
    }],
  },
  {
    id: "casual_dinner_two_turns",
    setup: () => {},
    turns: [
      {
        message: "我晚餐吃了土豆炖牛腩，分量挺大",
        requiredTools: ["log_meal"],
        expectedMealLogDelta: 1,
        check: (userId) => {
          const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
          return names.includes("土豆炖牛腩") || names.includes("牛腩") ? [] : [`第一轮口语化记餐没写库（已记：${names || "无"}）`];
        },
      },
      {
        message: "再补记一碗米饭",
        // 不预设记录条数：模型可能 edit 进同一条（delta 0）也可能新开一条（delta 1），以米饭落库为准。
        check: (userId) => {
          const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
          return names.includes("米饭") ? [] : [`第二轮补充记餐没写库（已记：${names || "无"}）`];
        },
      },
    ],
  },
  {
    id: "casual_snack_one_food",
    setup: () => {},
    turns: [{
      message: "下午加餐吃了一个苹果，记一下",
      requiredTools: ["log_meal"],
      expectedMealLogDelta: 1,
      check: (userId) => {
        const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
        return names.includes("苹果") ? [] : [`加餐记餐没写库（已记：${names || "无"}）`];
      },
    }],
  },
  {
    id: "casual_cafeteria_three_foods",
    setup: () => {},
    turns: [{
      message: "我中午在食堂吃了清蒸鲈鱼、炒青菜和一小碗米饭",
      requiredTools: ["log_meal"],
      expectedMealLogDelta: 1,
      check: (userId) => {
        const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
        return ["鲈鱼", "青菜", "米饭"].filter((expected) => !names.includes(expected))
          .map((expected) => `食堂多食物记餐缺了 ${expected}（已记：${names || "无"}）`);
      },
    }],
  },
  {
    id: "casual_morning_drink",
    setup: () => {},
    turns: [{
      message: "早上喝了一杯拿铁，帮我记一下",
      requiredTools: ["log_meal"],
      expectedMealLogDelta: 1,
      check: (userId) => {
        const names = store.getAllMealLogs(userId).flatMap((log) => log.foods.map((food) => food.name)).join("、");
        return names.includes("拿铁") ? [] : [`时段词记餐被日期追问卡住没写库（已记：${names || "无"}）`];
      },
    }],
  },
  {
    id: "hypothetical_without_write",
    setup: () => {},
    turns: [{
      message: "假如我今晚吃一份鸡胸肉，大概会怎样？这只是讨论假设，不要记到饮食记录里。",
      forbiddenTools: ["log_meal", "edit_meal_log", "undo_meal_log"],
      expectedMealLogDelta: 0,
      check: (userId) => store.getAllMealLogs(userId).length === 0 ? [] : ["假设性问题意外写入了餐食"],
    }],
  },
  {
    id: "allergy_temporary_limit_and_saved_plan",
    setup: (userId) => {
      store.upsertUserProfile(userId, { allergies: ["花生"], avoidFoods: ["香菜"] });
      store.upsertIngredientInventory(userId, {
        availableIngredients: [
          { name: "鸡腿", status: "available" },
          { name: "土豆", status: "available" },
          { name: "西兰花", status: "available" },
          { name: "苹果", status: "available" },
        ],
        replaceAvailable: true,
      });
    },
    turns: [
      {
        message: `请按我已记录的花生过敏，安排${date}的一日四餐。今天精力很低，每餐主动操作不超过15分钟；本次另外先不吃鸡蛋，这只是本次要求，不要改长期画像。`,
        requiredTools: ["generate_meal_plan"],
        forbiddenTools: ["log_meal", "update_user_profile"],
        expectedMealLogDelta: 0,
        expectPlanSaved: true,
        check: (userId) => {
          const plan = store.getMealPlanByStartDate(userId, date);
          if (!plan) return ["Agent 未保存当日饮食计划"];
          const effectiveProfile = { allergies: ["花生"], avoidFoods: ["香菜", "鸡蛋"] };
          const failures: string[] = [];
          const meals = plan.days[0]?.meals ?? [];
          if (meals.length !== 4) failures.push(`计划餐次数量为 ${meals.length}，预期 4`);
          for (const meal of meals) {
            if (meal.activeMinutes !== undefined && meal.activeMinutes > 15) failures.push(`${meal.name} 超出 15 分钟主动操作限制`);
            if (safety.assessFoodSafety(meal.ingredients, effectiveProfile).status !== "clear") failures.push(`${meal.name} 违反已知过敏或忌口`);
          }
          const profile = store.getUserProfile(userId);
          if (profile?.avoidFoods?.includes("鸡蛋")) failures.push("临时忌口被写进长期画像");
          return failures;
        },
      },
      {
        message: `查看${date}已经保存的饮食计划，只读取，不要新增餐食记录。`,
        requiredTools: ["get_meal_plan"],
        forbiddenTools: ["log_meal"],
        expectedMealLogDelta: 0,
        expectPlanSaved: true,
      },
    ],
  },
  {
    id: "cross_user_profile_isolation",
    setup: (userId, otherUserId) => {
      store.upsertUserProfile(userId, { allergies: ["花生"] });
      store.upsertUserProfile(otherUserId, { allergies: ["鸡蛋"] });
    },
    turns: [
      { message: "只列出我档案里记录的食物过敏。", requiredTools: ["get_user_profile"], check: (_userId, reply) => reply.includes("花生") ? [] : ["主用户画像没有反映到回复"] },
      { userScope: "other", message: "只列出我档案里记录的食物过敏。", requiredTools: ["get_user_profile"], check: (_userId, reply) => {
        const failures: string[] = [];
        if (!reply.includes("鸡蛋")) failures.push("第二用户画像没有反映到回复");
        if (reply.includes("花生")) failures.push("第二用户回复泄露了第一用户的过敏信息");
        return failures;
      } },
    ],
  },
];

const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const sessionUsers: string[] = [];
// agent 级错误（连接/认证等）说明本轮基础设施不可用，继续跑只会得到噪声。
let abortedByAgentError = false;

async function runPhaseScenarios(phase: "on" | "off"): Promise<ScenarioReport[]> {
  const phaseReport: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    if (abortedByAgentError) break;
    const runs: RunReport[] = [];
    for (let run = 1; run <= repeat; run++) {
      // 每次重复使用独立用户：setup 重新执行、写入状态互不污染。
      // userId 带 phase 标记，开关两阶段的会话与围栏互不串扰。
      const userId = `agent_eval_${runId}_${phase}_r${run}_${scenario.id}`;
      const otherUserId = `${userId}_other`;
      sessionUsers.push(userId, otherUserId);
      store.clearUserData(userId);
      store.clearUserData(otherUserId);
      scenario.setup(userId, otherUserId);
      const runStarted = Date.now();
      const turns: TurnReport[] = [];
      for (const spec of scenario.turns) {
        const turnUserId = spec.userScope === "other" ? otherUserId : userId;
        const tools: string[] = [];
        const toolErrors: string[] = [];
        const mealCountBefore = store.getAllMealLogs(turnUserId).length;
        const planExistedBefore = Boolean(store.getMealPlanByStartDate(turnUserId, date));
        const started = Date.now();
        let reply = "";
        try {
          const result = await sendDietAgentMessage(turnUserId, spec.message, {
            entry: "eval",
            onTextDelta: (text) => { reply = text; },
            onToolStatus: (status) => {
              if (status.phase === "pending") tools.push(status.toolName);
              if (status.phase === "error") toolErrors.push(status.toolName);
            },
          });
          reply = result.reply;
        } catch (error) {
          toolErrors.push(`agent:${error instanceof Error ? error.name : typeof error}`);
        }
        const requiredToolsMissing = (spec.requiredTools ?? []).filter((name) => !tools.includes(name));
        const forbiddenToolsUsed = tools.filter((name) => spec.forbiddenTools?.includes(name));
        const mealLogDelta = store.getAllMealLogs(turnUserId).length - mealCountBefore;
        const planSaved = !planExistedBefore && Boolean(store.getMealPlanByStartDate(turnUserId, date));
        const failures = spec.check?.(turnUserId, reply) ?? [];
        if (spec.expectedMealLogDelta !== undefined && mealLogDelta !== spec.expectedMealLogDelta) {
          failures.push(`餐食记录变化 ${mealLogDelta}，预期 ${spec.expectedMealLogDelta}`);
        }
        if (spec.expectPlanSaved !== undefined && !planExistedBefore && planSaved !== spec.expectPlanSaved) {
          failures.push(`计划保存状态 ${planSaved}，预期 ${spec.expectPlanSaved}`);
        }
        turns.push({
          toolCalls: tools,
          mealLogDelta,
          planSaved,
          requiredToolsMissing,
          forbiddenToolsUsed,
          toolErrors,
          failures,
          durationMs: Date.now() - started,
        });
      }
      const runPassed = turns.every((turn) => !turn.requiredToolsMissing.length && !turn.forbiddenToolsUsed.length && !turn.toolErrors.length && !turn.failures.length);
      runs.push({ run, turns, passed: runPassed, durationMs: Date.now() - runStarted });
      if (turns.some((turn) => turn.toolErrors.some((error) => error.startsWith("agent:")))) {
        abortedByAgentError = true;
        break;
      }
    }
    const allTurns = runs.flatMap((item) => item.turns);
    const passedRuns = runs.filter((item) => item.passed).length;
    const toolCallCount = allTurns.reduce((count, turn) => count + turn.toolCalls.length, 0);
    // agent:* 是会话级错误而非工具执行失败，不计入工具成功率。
    const toolFailureCount = allTurns.reduce(
      (count, turn) => count + turn.toolErrors.filter((error) => !error.startsWith("agent:")).length, 0);
    phaseReport.push({
      id: scenario.id,
      runs,
      passed: runs.length > 0 && runs.every((item) => item.passed),
      aggregate: {
        passedRuns,
        runCount: runs.length,
        passRate: runs.length > 0 ? Math.round((passedRuns / runs.length) * 1000) / 1000 : 0,
        runMs: metricTriple(runs.map((item) => item.durationMs)),
        toolCalls: toolCallCount,
        toolErrors: allTurns.reduce((count, turn) => count + turn.toolErrors.length, 0),
        toolCallSuccessRate: toolCallCount > 0
          ? Math.round(((toolCallCount - toolFailureCount) / toolCallCount) * 1000) / 1000
          : null,
        forbiddenToolCalls: allTurns.reduce((count, turn) => count + turn.forbiddenToolsUsed.length, 0),
        stateOrSafetyFailures: allTurns.reduce((count, turn) => count + turn.failures.length, 0),
      },
    });
  }
  return phaseReport;
}

function computeTotals(scenarioReports: ScenarioReport[]) {
  const allRuns = scenarioReports.flatMap((item) => item.runs);
  const allTurns = allRuns.flatMap((item) => item.turns);
  const toolCallCount = allTurns.reduce((count, turn) => count + turn.toolCalls.length, 0);
  // agent:* 是会话级错误而非工具执行失败，不计入工具成功率。
  const toolFailureCount = allTurns.reduce(
    (count, turn) => count + turn.toolErrors.filter((error) => !error.startsWith("agent:")).length, 0);
  return {
    scenarios: scenarioReports.length,
    scenariosFullyPassed: scenarioReports.filter((item) => item.passed).length,
    runs: allRuns.length,
    runsPassed: allRuns.filter((item) => item.passed).length,
    scenarioPassRate: metricTriple(scenarioReports.map((item) => item.aggregate.passRate)),
    turns: allTurns.length,
    toolCalls: toolCallCount,
    toolCallSuccessRate: toolCallCount > 0
      ? Math.round(((toolCallCount - toolFailureCount) / toolCallCount) * 1000) / 1000
      : null,
    mealLogWrites: allTurns.reduce((count, turn) => count + turn.mealLogDelta, 0),
    persistedPlans: allTurns.filter((turn) => turn.planSaved).length,
    missingRequiredTools: allTurns.reduce((count, turn) => count + turn.requiredToolsMissing.length, 0),
    forbiddenToolCalls: allTurns.reduce((count, turn) => count + turn.forbiddenToolsUsed.length, 0),
    toolErrors: allTurns.reduce((count, turn) => count + turn.toolErrors.length, 0),
    stateOrSafetyFailures: allTurns.reduce((count, turn) => count + turn.failures.length, 0),
    averageTurnMs: Math.round(allTurns.reduce((sum, turn) => sum + turn.durationMs, 0) / Math.max(1, allTurns.length)),
  };
}

// ─── B 组：按模型统计（延迟/token/成本直接取自本进程 in-memory trace，entry=eval） ───
interface ModelTraceStat {
  model: string;
  requests: number;
  requestShare: number;
  fallbackArrivals: number;
  avgAttempts: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p50FirstTokenMs: number | null;
  avgToolCallsPerRequest: number;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  avgCacheReadTokens: number | null;
  usageReportedRequests: number;
  totalCostUsd: number | null;
}

function percentileOf(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function summarizeModels(rows: Array<{
  status: string; duration_ms: number | null; first_token_ms: number | null; attempts: number;
  final_model: string | null; tool_calls: number;
  input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cost_usd: number | null;
}>): ModelTraceStat[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.final_model ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const totalRequests = rows.length || 1;
  const average = (values: number[]): number | null => values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  return [...groups.entries()]
    .map(([model, group]) => ({
      model,
      requests: group.length,
      requestShare: Math.round((group.length / totalRequests) * 1000) / 1000,
      fallbackArrivals: group.filter((row) => row.attempts > 1).length,
      avgAttempts: Math.round((group.reduce((sum, row) => sum + row.attempts, 0) / group.length) * 100) / 100,
      p50DurationMs: percentileOf(group.map((row) => row.duration_ms ?? 0).filter((value) => value > 0).sort((a, b) => a - b), 50),
      p95DurationMs: percentileOf(group.map((row) => row.duration_ms ?? 0).filter((value) => value > 0).sort((a, b) => a - b), 95),
      p50FirstTokenMs: percentileOf(group.map((row) => row.first_token_ms ?? 0).filter((value) => value > 0).sort((a, b) => a - b), 50),
      avgToolCallsPerRequest: Math.round((group.reduce((sum, row) => sum + row.tool_calls, 0) / group.length) * 100) / 100,
      avgInputTokens: average(group.map((row) => row.input_tokens).filter((value): value is number => value !== null)),
      avgOutputTokens: average(group.map((row) => row.output_tokens).filter((value): value is number => value !== null)),
      avgCacheReadTokens: average(group.map((row) => row.cache_read_tokens).filter((value): value is number => value !== null)),
      usageReportedRequests: group.filter((row) => row.input_tokens !== null || row.output_tokens !== null).length,
      totalCostUsd: group.some((row) => row.cost_usd !== null)
        ? Math.round(group.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0) * 10000) / 10000
        : null,
    }))
    .sort((left, right) => right.requests - left.requests);
}

interface PhaseReport {
  phase: "on" | "off";
  toolRepair?: ToolRepairTelemetrySummary;
  totals: ReturnType<typeof computeTotals>;
  scenarios: ScenarioReport[];
}

const phaseReports: PhaseReport[] = [];
// 各阶段的起止时间：B 组模型统计只取“修复开”窗口，避免对照阶段的
// 重试/失败流量污染延迟与 token 数据。
const phaseWindows: Array<{ phase: "on" | "off"; startedAt: number; endedAt: number }> = [];
let models: ModelTraceStat[] = [];
let modelsScope = "";
try {
  // 修复开关按调用懒读取 DIET_TOOL_REPAIR，可在同进程内按阶段切换。
  for (const phase of phases) {
    if (abortedByAgentError) break;
    const phaseStartedAt = Date.now();
    process.env.DIET_TOOL_REPAIR = phase;
    // 参数问题率只在修复开启时有意义（对比修复前后差异）：off 阶段不记录遥测。
    if (phase === "on") startToolRepairRecording();
    const phaseScenarios = await runPhaseScenarios(phase);
    const toolRepair = phase === "on" ? stopToolRepairRecording() : undefined;
    phaseReports.push({ phase, toolRepair, totals: computeTotals(phaseScenarios), scenarios: phaseScenarios });
    phaseWindows.push({ phase, startedAt: phaseStartedAt, endedAt: Date.now() });
  }
} finally {
  // 关库前从 in-memory trace 取 B 组数据（entry=eval，仅修复开窗口）；查询失败不影响评测结果。
  const onWindow = phaseWindows.find((window) => window.phase === "on");
  try {
    const { getTraceWindow } = await import("../src/store/repositories/traceRepository.js");
    if (!onWindow) {
      models = [];
      modelsScope = "skipped：本运行只有修复关阶段，B 组模型统计只取修复开阶段";
    } else {
      models = summarizeModels(
        getTraceWindow(store.getDatabase(), onWindow.startedAt - 1_000, ["eval"])
          .filter((row) => row.started_at < onWindow.endedAt),
      );
      modelsScope = repairCompare
        ? "仅修复开阶段窗口（修复关阶段的重试/失败会拉高延迟与 token，不纳入）"
        : "整轮运行（单阶段修复开）";
    }
  } catch {
    models = [];
    modelsScope = "skipped：trace 查询失败";
  }
  for (const userId of sessionUsers) clearUserAgentSession(userId);
  disposeAllAgentSessions();
  store.closeDatabase();
}

const primaryPhase = phaseReports[0];
const runPassRateOf = (phase: PhaseReport | undefined): number | null =>
  phase && phase.totals.runs > 0 ? Math.round((phase.totals.runsPassed / phase.totals.runs) * 1000) / 1000 : null;
const repairComparison = phaseReports.length === 2 && primaryPhase && phaseReports[1]
  ? {
    toolCallSuccessRate: { on: primaryPhase.totals.toolCallSuccessRate, off: phaseReports[1].totals.toolCallSuccessRate },
    runPassRate: { on: runPassRateOf(primaryPhase), off: runPassRateOf(phaseReports[1]) },
    // 参数问题率来自修复开阶段：X% 的工具调用存在格式问题（无需关闭对照即可得到）。
    argumentIssueRate: primaryPhase.toolRepair?.issueRate ?? null,
    // 两阶段固定先开后关：第二阶段可能受益于 provider 预热缓存，且修复关阶段
    // 失败/重试更多——延迟与成本不可跨阶段比较，对比仅限成功率与问题率。
    note: "对比仅限成功率与参数问题率；延迟/成本不可跨阶段比较（预热缓存与重试噪声），B 组模型统计只取修复开阶段",
  }
  : undefined;

const output = {
  suite: "live diet-agent behavior evaluation",
  runId,
  date: new Date().toISOString(),
  gitCommit,
  repeat,
  primaryProvider: configuredModels[0]?.label,
  modelCandidates: configuredModels.map((model) => model.label),
  repairPhases: phaseReports,
  repairComparison,
  models,
  modelsScope,
  // 便捷字段：默认阶段（产品行为）的汇总与明细。
  totals: primaryPhase?.totals,
  scenarios: primaryPhase?.scenarios,
};
const resultDir = join(process.cwd(), "data", "eval-results");
mkdirSync(resultDir, { recursive: true });
const resultFile = join(resultDir, `agent-eval-${runId}${repairComparison ? "-repair-compare" : phases[0] === "off" ? "-repair-off" : ""}.json`);
writeFileSync(resultFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

// 人类可读摘要：A 组对比 + B 组模型行；完整数据在结果 JSON。
for (const phase of phaseReports) {
  const label = phase.phase === "on" ? "修复开" : "修复关";
  console.log(
    `🧪 ${label}: 轮次通过 ${phase.totals.runsPassed}/${phase.totals.runs}` +
    `，工具成功率 ${phase.totals.toolCallSuccessRate === null ? "-" : `${(phase.totals.toolCallSuccessRate * 100).toFixed(1)}%`}` +
    (phase.toolRepair ? `，参数问题率 ${(phase.toolRepair.issueRate * 100).toFixed(1)}%（${phase.toolRepair.callsWithIssues}/${phase.toolRepair.toolCalls}）` : ""),
  );
}
for (const stat of models) {
  console.log(
    `🤖 ${stat.model}: ${stat.requests} 请求（占 ${(stat.requestShare * 100).toFixed(0)}%，fallback 到达 ${stat.fallbackArrivals}）` +
    `，p50 ${stat.p50DurationMs === null ? "-" : `${(stat.p50DurationMs / 1000).toFixed(1)}s`}` +
    `，首token p50 ${stat.p50FirstTokenMs === null ? "-" : `${(stat.p50FirstTokenMs / 1000).toFixed(1)}s`}` +
    `，avg 工具 ${stat.avgToolCallsPerRequest} 次` +
    `，in/out/cache ${stat.avgInputTokens ?? "-"}/${stat.avgOutputTokens ?? "-"}/${stat.avgCacheReadTokens ?? "-"}` +
    `，$${stat.totalCostUsd ?? "-"}`,
  );
}
console.log(`📄 完整结果: ${resultFile}`);
// 退出码只看默认阶段（产品行为）。对照阶段（修复关）本来就可能更差，不应让评测“失败”。
if (primaryPhase && (primaryPhase.totals.runsPassed !== primaryPhase.totals.runs
  || primaryPhase.totals.toolErrors > 0
  || primaryPhase.totals.forbiddenToolCalls > 0
  || primaryPhase.totals.stateOrSafetyFailures > 0)) {
  process.exitCode = 1;
}
