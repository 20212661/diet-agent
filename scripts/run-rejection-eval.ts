/**
 * 否决捕获三臂评测 runner：10 段对话 × { 仅规则 / 仅 LLM / 规则+LLM } 的捕获率与误捕率。
 *
 * 用法：npm run eval:rejection            # 离线：仅规则臂（确定性）
 *      npm run eval:rejection -- --live  # 三臂全跑（LLM 臂需 DEEPSEEK_API_KEY）
 *
 * 标注：对话段与期望否决集为 LLM 标注（GLM 起草，见 rejectionScenarios.ts 头注）。
 * 口径：捕获率（按道）= 正确捕获道数 / 期望总道数；误捕（按道）= 捕获但不期望的道数
 * （含 N9/N10 中的任何捕获与 R/F 段多捕的菜）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.DIET_AGENT_DB_PATH = process.env.DIET_AGENT_DB_PATH ?? join(process.cwd(), "data", "eval", `rejection-eval-${Date.now()}.sqlite`);

const live = process.argv.includes("--live");
const { REJECTION_SCENARIOS } = await import("../src/eval/rejectionScenarios.js");
const store = await import("../src/store/index.js");
const {
  ensureMealPlanTask,
  captureRuleRejections,
  getInjectableTask,
  noteSuggestedRecipes,
} = await import("../src/tasks/taskStateService.js");
const { extractAndApplyTaskPatch } = await import("../src/tasks/taskStateExtractor.js");

function suggestedIds(names: readonly string[]): string[] {
  const book = store.getRecipeBook();
  return names
    .map((name) => book.find((recipe) => recipe.name === name)?.id)
    .filter((id): id is string => id !== undefined);
}

async function capturedNames(userId: string): Promise<string[]> {
  const task = getInjectableTask(userId);
  return (task?.rejected ?? []).map((item) => item.name);
}

async function runSegment(
  scenarioId: string,
  suggestedNames: readonly string[],
  message: string,
  arm: "rule" | "llm" | "rule+llm"
): Promise<string[]> {
  const userId = `rej_${arm}_${scenarioId}`;
  store.clearUserData(userId);
  ensureMealPlanTask(userId);
  noteSuggestedRecipes(userId, suggestedIds(suggestedNames));
  if (arm === "rule" || arm === "rule+llm") {
    captureRuleRejections(userId, message);
  }
  if (arm === "llm" || arm === "rule+llm") {
    await extractAndApplyTaskPatch(userId, message, "（本轮推荐已给出）");
  }
  return capturedNames(userId);
}

interface ArmSummary {
  arm: string;
  capturedCorrect: number;
  expectedTotal: number;
  captureRate: number;
  falsePositives: number;
  segments: Array<{ id: string; expected: string[]; actual: string[] }>;
}

async function runArm(arm: "rule" | "llm" | "rule+llm"): Promise<ArmSummary> {
  const segments: ArmSummary["segments"] = [];
  let capturedCorrect = 0;
  let expectedTotal = 0;
  let falsePositives = 0;
  for (const scenario of REJECTION_SCENARIOS) {
    const actual = await runSegment(scenario.id, scenario.suggestedNames, scenario.message, arm);
    const expected = scenario.expectedRejected;
    expectedTotal += expected.length;
    for (const name of expected) {
      if (actual.includes(name)) capturedCorrect += 1;
    }
    for (const name of actual) {
      if (!expected.includes(name)) falsePositives += 1;
    }
    segments.push({ id: scenario.id, expected, actual });
    console.log(`  [${scenario.id}] 期望=[${expected.join("、") || "不捕获"}] 实捕=[${actual.join("、") || "—"}]`);
  }
  return {
    arm,
    capturedCorrect,
    expectedTotal,
    captureRate: expectedTotal > 0 ? capturedCorrect / expectedTotal : 0,
    falsePositives,
    segments,
  };
}

const arms: ArmSummary[] = [];
console.log("== 仅规则（确定性） ==");
arms.push(await runArm("rule"));
if (live) {
  console.log("\n== 仅 LLM（live） ==");
  arms.push(await runArm("llm"));
  console.log("\n== 规则 + LLM（live） ==");
  arms.push(await runArm("rule+llm"));
} else {
  console.log("\n（加 --live 跑 LLM 两臂；仅规则臂为确定性离线结果）");
}

console.log("\n==== 汇总（标注：期望集为 LLM 标注，GLM 起草） ====");
for (const arm of arms) {
  console.log(`${arm.arm}：捕获率（按道）=${(arm.captureRate * 100).toFixed(0)}%（${arm.capturedCorrect}/${arm.expectedTotal}）  误捕（按道）=${arm.falsePositives}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = join(process.cwd(), "data", "eval-results", `rejection-eval-${stamp}.json`);
mkdirSync(join(process.cwd(), "data", "eval-results"), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), 标注来源: "LLM 标注（GLM 起草）：对话段与期望否决集", arms }, null, 2)}\n`, "utf8");
console.log(`报告已写入 ${reportPath}`);

if (arms.some((arm) => arm.falsePositives > 2)) {
  console.error("误捕超过容忍（>2）");
  process.exitCode = 1;
}
