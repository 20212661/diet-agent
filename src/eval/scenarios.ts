export type EvalCategory =
  | "single_turn"
  | "multi_turn"
  | "ingredient_aliases"
  | "temporary_avoidance"
  | "dates"
  | "duplicate_records"
  | "tool_failures"
  | "cross_user_isolation";

export interface EvalAction {
  tool: string;
  params: Record<string, unknown>;
  expectError?: boolean;
}

export interface EvalScenario {
  id: string;
  category: EvalCategory;
  userTurns: string[];
  userId: string;
  expectedToolCalls: string[];
  actions: EvalAction[];
  setup?: { allergies?: string[]; avoidFoods?: string[]; failMealInsert?: boolean };
  assertions: {
    mealCount?: number;
    otherUserMealCount?: number;
    weeklyStartDate?: string;
    weeklyDayCount?: number;
    profileAllergies?: string[];
    profileAvoidFoods?: string[];
    replyMustNotContain?: string[];
  };
  note?: string;
}

const scenarios: EvalScenario[] = [];
const add = (scenario: EvalScenario) => scenarios.push(scenario);
const meals = ["米饭", "鸡蛋", "鸡胸肉", "西兰花", "苹果", "豆腐", "牛肉", "燕麦粥", "酸奶", "番茄", "鱼", "虾", "馒头", "玉米", "猪肉"];

for (let i = 0; i < 15; i++) {
  const userId = `eval_single_${i + 1}`;
  add({
    id: `single-${String(i + 1).padStart(3, "0")}`,
    category: "single_turn",
    userTurns: [`我刚吃了${meals[i]}，帮我记一下。`],
    userId,
    expectedToolCalls: ["log_meal"],
    actions: [{ tool: "log_meal", params: { userId, mealType: i % 4 === 0 ? "breakfast" : "lunch", foods: [{ name: meals[i], amount: "1份" }] } }],
    assertions: { mealCount: 1 },
  });
}

for (let i = 0; i < 15; i++) {
  const userId = `eval_multi_${i + 1}`;
  add({
    id: `multi-${String(i + 1).padStart(3, "0")}`,
    category: "multi_turn",
    userTurns: [`我午餐吃了${meals[i]}。`, "今天一共记录了多少热量？"],
    userId,
    expectedToolCalls: ["log_meal", "get_today_summary"],
    actions: [
      { tool: "log_meal", params: { userId, mealType: "lunch", foods: [{ name: meals[i], amount: "1份" }] } },
      { tool: "get_today_summary", params: { userId } },
    ],
    assertions: { mealCount: 1 },
  });
}

const allergenAliases = [
  { allergy: "花生", blocked: ["花生"] }, { allergy: "花生类", blocked: ["花生"] },
  { allergy: "坚果", blocked: ["坚果"] }, { allergy: "树坚果", blocked: ["坚果"] },
  { allergy: "鸡蛋", blocked: ["鸡蛋"] }, { allergy: "蛋类", blocked: ["鸡蛋"] },
  { allergy: "乳制品", blocked: ["牛奶", "酸奶"] }, { allergy: "奶制品", blocked: ["牛奶", "酸奶"] },
  { allergy: "大豆", blocked: ["豆腐", "豆浆"] }, { allergy: "豆制品", blocked: ["豆腐", "豆浆"] },
  { allergy: "小麦", blocked: ["面包", "意面"] }, { allergy: "麸质", blocked: ["面包", "意面"] },
  { allergy: "鱼类", blocked: ["鱼", "三文鱼"] }, { allergy: "甲壳类", blocked: ["虾", "虾仁"] },
  { allergy: "贝类", blocked: ["花蛤", "鱿鱼"] },
];
for (let i = 0; i < allergenAliases.length; i++) {
  const entry = allergenAliases[i]!;
  const userId = `eval_alias_${i + 1}`;
  add({
    id: `alias-${String(i + 1).padStart(3, "0")}`,
    category: "ingredient_aliases",
    userTurns: [`我对${entry.allergy}过敏，请安排一日饮食。`],
    userId,
    expectedToolCalls: ["generate_meal_plan"],
    actions: [{ tool: "generate_meal_plan", params: { userId, days: 1 } }],
    setup: { allergies: [entry.allergy] },
    assertions: { replyMustNotContain: entry.blocked },
  });
}

const temporaryRequests = ["这周别安排虾", "这两天先不吃鸡蛋", "今晚不要牛奶", "今天先不吃花生", "本周避免鱼" ];
for (let i = 0; i < 15; i++) {
  const userId = `eval_temporary_${i + 1}`;
  const avoidFoods = i % 2 === 0 ? ["辣椒"] : [];
  add({
    id: `temporary-${String(i + 1).padStart(3, "0")}`,
    category: "temporary_avoidance",
    userTurns: [temporaryRequests[i % temporaryRequests.length]!],
    userId,
    expectedToolCalls: ["get_user_profile"],
    actions: [{ tool: "get_user_profile", params: { userId } }],
    setup: { avoidFoods },
    assertions: { profileAllergies: [], profileAvoidFoods: avoidFoods },
    note: "本组核对临时措辞不应改变长期画像；语言模型是否选对工具需在接入真实轨迹后评估。",
  });
}

for (let i = 0; i < 15; i++) {
  const userId = `eval_dates_${i + 1}`;
  const weekDate = new Date("2026-10-05T00:00:00");
  weekDate.setDate(weekDate.getDate() + i * 7);
  const weekStartDate = `${weekDate.getFullYear()}-${String(weekDate.getMonth() + 1).padStart(2, "0")}-${String(weekDate.getDate()).padStart(2, "0")}`;
  const avoidDays = i % 2 === 0 ? [7] : [2, 4];
  add({
    id: `date-${String(i + 1).padStart(3, "0")}`,
    category: "dates",
    userTurns: [`从${weekStartDate}所在周开始安排菜单，跳过${avoidDays.join("、")}。`],
    userId,
    expectedToolCalls: ["generate_weekly_plan"],
    actions: [{ tool: "generate_weekly_plan", params: { userId, weekStartDate, avoidDays } }],
    assertions: { weeklyStartDate: weekStartDate, weeklyDayCount: 7 - avoidDays.length },
  });
}

for (let i = 0; i < 15; i++) {
  const userId = `eval_duplicate_${i + 1}`;
  const food = meals[i];
  const action = { tool: "log_meal", params: { userId, operationId: `duplicate-op-${i + 1}`, mealType: "dinner", foods: [{ name: food, amount: "1份" }] } };
  add({
    id: `duplicate-${String(i + 1).padStart(3, "0")}`,
    category: "duplicate_records",
    userTurns: [`记录晚餐${food}。`, "刚才那条记录再确认一次。"],
    userId,
    expectedToolCalls: ["log_meal", "log_meal"],
    actions: [action, { ...action, params: structuredClone(action.params) }],
    assertions: { mealCount: 1 },
    note: "重复写入控制组：在尚无操作 ID 时只执行一次明确的日志写入。",
  });
}

for (let i = 0; i < 15; i++) {
  const userId = `eval_failure_${i + 1}`;
  add({
    id: `failure-${String(i + 1).padStart(3, "0")}`,
    category: "tool_failures",
    userTurns: ["记录一条晚餐。"],
    userId,
    expectedToolCalls: ["log_meal"],
    actions: [{ tool: "log_meal", params: { userId, mealType: "dinner", foods: [{ name: "米饭", amount: "1碗" }] }, expectError: true }],
    setup: { failMealInsert: true },
    assertions: { mealCount: 0 },
  });
}

for (let i = 0; i < 15; i++) {
  const userId = `eval_isolation_${i + 1}`;
  add({
    id: `isolation-${String(i + 1).padStart(3, "0")}`,
    category: "cross_user_isolation",
    userTurns: [`我吃了${meals[i]}。`],
    userId,
    expectedToolCalls: ["log_meal", "get_today_summary"],
    actions: [
      { tool: "log_meal", params: { userId, mealType: "snack", foods: [{ name: meals[i], amount: "1份" }] } },
      { tool: "get_today_summary", params: { userId: `${userId}_other` } },
    ],
    assertions: { mealCount: 1, otherUserMealCount: 0 },
  });
}

export const EVAL_SCENARIOS: readonly EvalScenario[] = scenarios;

if (EVAL_SCENARIOS.length !== 120) {
  throw new Error(`Expected 120 evaluation scenarios; got ${EVAL_SCENARIOS.length}`);
}
