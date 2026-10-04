import type { EvalCategory, EvalScenario } from "../src/eval/scenarios.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const [{ EVAL_SCENARIOS }, store, database, tools] = await Promise.all([
  import("../src/eval/scenarios.js"),
  import("../src/store/index.js"),
  import("../src/store/database.js"),
  Promise.all([
    import("../src/tools/logMeal.js"),
    import("../src/tools/getTodaySummary.js"),
    import("../src/tools/generateMealPlan.js"),
    import("../src/tools/generateWeeklyPlan.js"),
    import("../src/tools/getUserProfile.js"),
  ]),
]);

const toolByName: Record<string, any> = {
  log_meal: tools[0].logMealTool,
  get_today_summary: tools[1].getTodaySummaryTool,
  generate_meal_plan: tools[2].generateMealPlanTool,
  generate_weekly_plan: tools[3].generateWeeklyPlanTool,
  get_user_profile: tools[4].getUserProfileTool,
};
const context = {} as any;
const categories: EvalCategory[] = [
  "single_turn", "multi_turn", "ingredient_aliases", "temporary_avoidance",
  "dates", "duplicate_records", "tool_failures", "cross_user_isolation",
];

interface ScenarioResult {
  id: string;
  category: EvalCategory;
  complete: boolean;
  traceMismatch: boolean;
  hardConstraintViolations: number;
  incorrectWrites: number;
  unexpectedToolErrors: number;
  expectedToolErrors: number;
  failures: string[];
}

function textOf(result: any): string {
  return (result?.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runScenario(scenario: EvalScenario): Promise<ScenarioResult> {
  const failures: string[] = [];
  let hardConstraintViolations = 0;
  let incorrectWrites = 0;
  let unexpectedToolErrors = 0;
  let expectedToolErrors = 0;
  const actualTrace: string[] = [];
  const outputs: string[] = [];
  const db = database.getDatabase();

  if (scenario.setup?.allergies || scenario.setup?.avoidFoods) {
    store.upsertUserProfile(scenario.userId, {
      allergies: scenario.setup.allergies ?? [],
      avoidFoods: scenario.setup.avoidFoods ?? [],
    });
  }
  if (scenario.setup?.failMealInsert) {
    db.exec(`CREATE TRIGGER eval_fail_meal_${scenario.id.replace(/-/g, "_")} BEFORE INSERT ON meal_logs BEGIN SELECT RAISE(FAIL, 'fixture tool failure'); END;`);
  }

  try {
    for (const action of scenario.actions) {
      actualTrace.push(action.tool);
      const tool = toolByName[action.tool];
      if (!tool) {
        failures.push(`unknown fixture tool: ${action.tool}`);
        unexpectedToolErrors++;
        continue;
      }
      try {
        const result = await tool.execute(`${scenario.id}_${actualTrace.length}`, action.params, undefined, undefined, context);
        outputs.push(textOf(result));
        if (action.expectError) failures.push(`expected ${action.tool} to fail, but it succeeded`);
        if (action.expectError) unexpectedToolErrors++;
      } catch (error) {
        if (action.expectError) expectedToolErrors++;
        else {
          unexpectedToolErrors++;
          failures.push(`${action.tool} threw: ${(error as Error).message}`);
        }
      }
    }
  } finally {
    if (scenario.setup?.failMealInsert) {
      db.exec(`DROP TRIGGER IF EXISTS eval_fail_meal_${scenario.id.replace(/-/g, "_")};`);
    }
  }

  const traceMismatch = !equal(actualTrace, scenario.expectedToolCalls);
  if (traceMismatch) failures.push(`tool trace ${JSON.stringify(actualTrace)} != ${JSON.stringify(scenario.expectedToolCalls)}`);

  const assertions = scenario.assertions;
  const mealCount = store.getAllMealLogs(scenario.userId).length;
  if (assertions.mealCount !== undefined && mealCount !== assertions.mealCount) {
    incorrectWrites++;
    failures.push(`meal count ${mealCount} != ${assertions.mealCount}`);
  }
  if (assertions.otherUserMealCount !== undefined) {
    const otherCount = store.getAllMealLogs(`${scenario.userId}_other`).length;
    if (otherCount !== assertions.otherUserMealCount) {
      incorrectWrites++;
      failures.push(`other-user meal count ${otherCount} != ${assertions.otherUserMealCount}`);
    }
  }
  if (assertions.weeklyStartDate !== undefined || assertions.weeklyDayCount !== undefined) {
    const plan = store.getWeeklyPlan(scenario.userId, assertions.weeklyStartDate);
    if (!plan || plan.weekStartDate !== assertions.weeklyStartDate) {
      incorrectWrites++;
      failures.push(`weekly plan start date ${plan?.weekStartDate ?? "missing"} != ${assertions.weeklyStartDate}`);
    } else if (assertions.weeklyDayCount !== undefined && plan.days.length !== assertions.weeklyDayCount) {
      incorrectWrites++;
      failures.push(`weekly plan days ${plan.days.length} != ${assertions.weeklyDayCount}`);
    }
  }
  if (assertions.profileAllergies !== undefined || assertions.profileAvoidFoods !== undefined) {
    const profile = store.getUserProfile(scenario.userId);
    if (assertions.profileAllergies !== undefined && !equal(profile?.allergies ?? [], assertions.profileAllergies)) {
      incorrectWrites++;
      failures.push(`profile allergies changed: ${JSON.stringify(profile?.allergies ?? [])}`);
    }
    if (assertions.profileAvoidFoods !== undefined && !equal(profile?.avoidFoods ?? [], assertions.profileAvoidFoods)) {
      incorrectWrites++;
      failures.push(`profile avoidFoods changed: ${JSON.stringify(profile?.avoidFoods ?? [])}`);
    }
  }
  if (assertions.replyMustNotContain?.length) {
    // The tool now reports the active restriction list after its meal entries;
    // exclude that disclosure line when checking whether blocked foods were recommended.
    const recommendationText = outputs.join("\n").split(/(?:🚫\s*)?已按已知食材信息筛选:/)[0] ?? outputs.join("\n");
    const found = assertions.replyMustNotContain.filter((term) => recommendationText.includes(term));
    if (found.length) {
      hardConstraintViolations += found.length;
      failures.push(`blocked foods appeared in recommendation: ${found.join(", ")}`);
    }
  }

  return {
    id: scenario.id,
    category: scenario.category,
    complete: !traceMismatch && unexpectedToolErrors === 0 && failures.length === 0,
    traceMismatch,
    hardConstraintViolations,
    incorrectWrites,
    unexpectedToolErrors,
    expectedToolErrors,
    failures,
  };
}

const results: ScenarioResult[] = [];
for (const scenario of EVAL_SCENARIOS) results.push(await runScenario(scenario));

const report = {
  suite: "diet-agent deterministic tool-flow eval",
  mode: "offline scripted replay; does not call an LLM or incur model API usage",
  scenarioCount: results.length,
  categories: Object.fromEntries(categories.map((category) => {
    const items = results.filter((result) => result.category === category);
    return [category, { total: items.length, complete: items.filter((item) => item.complete).length, failed: items.filter((item) => !item.complete).length }];
  })),
  metrics: {
    hardConstraintViolations: results.reduce((sum, item) => sum + item.hardConstraintViolations, 0),
    incorrectWrites: results.reduce((sum, item) => sum + item.incorrectWrites, 0),
    taskCompletion: `${results.filter((item) => item.complete).length}/${results.length}`,
    unexpectedToolErrors: results.reduce((sum, item) => sum + item.unexpectedToolErrors, 0),
    expectedToolErrorsHandled: results.reduce((sum, item) => sum + item.expectedToolErrors, 0),
  },
  failures: results.filter((result) => !result.complete).map(({ id, category, failures }) => ({ id, category, failures })),
};

console.log(JSON.stringify(report, null, 2));
if (report.metrics.hardConstraintViolations || report.metrics.incorrectWrites || report.metrics.unexpectedToolErrors) {
  process.exitCode = 1;
}
