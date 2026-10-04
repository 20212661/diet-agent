/** Opt-in black-box evaluation through the configured live model and real AgentSession. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (!process.argv.includes("--live")) {
  throw new Error("This evaluator calls a configured model API. Run it explicitly with `npm run eval:agent`.");
}

process.env.DIET_AGENT_DB_PATH = ":memory:";

const [store, agentModule, storeDate, safety] = await Promise.all([
  import("../src/store/index.js"),
  import("../src/agent/createDietAgent.js"),
  import("../src/store/shared.js"),
  import("../src/recipes/foodSafety.js"),
]);
const { sendDietAgentMessage, clearUserAgentSession, disposeAllAgentSessions } = agentModule;
const { todayDate } = storeDate;
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
interface ScenarioReport {
  id: string;
  turns: TurnReport[];
  passed: boolean;
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
const report: ScenarioReport[] = [];
const sessionUsers: string[] = [];
try {
  for (const scenario of scenarios) {
    const userId = `agent_eval_${runId}_${scenario.id}`;
    const otherUserId = `${userId}_other`;
    sessionUsers.push(userId, otherUserId);
    store.clearUserData(userId);
    store.clearUserData(otherUserId);
    scenario.setup(userId, otherUserId);
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
    report.push({
      id: scenario.id,
      turns,
      passed: turns.every((turn) => !turn.requiredToolsMissing.length && !turn.forbiddenToolsUsed.length && !turn.toolErrors.length && !turn.failures.length),
    });
    if (turns.some((turn) => turn.toolErrors.some((error) => error.startsWith("agent:")))) break;
  }
} finally {
  for (const userId of sessionUsers) clearUserAgentSession(userId);
  disposeAllAgentSessions();
  store.closeDatabase();
}

const totals = {
  scenarios: report.length,
  passed: report.filter((item) => item.passed).length,
  turns: report.reduce((sum, item) => sum + item.turns.length, 0),
  mealLogWrites: report.reduce((sum, item) => sum + item.turns.reduce((n, turn) => n + turn.mealLogDelta, 0), 0),
  persistedPlans: report.reduce((sum, item) => sum + item.turns.filter((turn) => turn.planSaved).length, 0),
  missingRequiredTools: report.reduce((sum, item) => sum + item.turns.reduce((n, turn) => n + turn.requiredToolsMissing.length, 0), 0),
  forbiddenToolCalls: report.reduce((sum, item) => sum + item.turns.reduce((n, turn) => n + turn.forbiddenToolsUsed.length, 0), 0),
  toolErrors: report.reduce((sum, item) => sum + item.turns.reduce((n, turn) => n + turn.toolErrors.length, 0), 0),
  stateOrSafetyFailures: report.reduce((sum, item) => sum + item.turns.reduce((n, turn) => n + turn.failures.length, 0), 0),
  averageTurnMs: Math.round(report.flatMap((item) => item.turns).reduce((sum, turn) => sum + turn.durationMs, 0) / Math.max(1, report.reduce((sum, item) => sum + item.turns.length, 0))),
};
const output = { suite: "live diet-agent behavior evaluation", runId, modelCandidates: configuredModels.map((model) => model.label), totals, scenarios: report };
const resultDir = join(process.cwd(), "data", "eval-results");
mkdirSync(resultDir, { recursive: true });
const resultFile = join(resultDir, `agent-eval-${runId}.json`);
writeFileSync(resultFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...output, resultFile }, null, 2));
if (totals.passed !== totals.scenarios || totals.toolErrors > 0 || totals.forbiddenToolCalls > 0 || totals.stateOrSafetyFailures > 0) {
  process.exitCode = 1;
}
