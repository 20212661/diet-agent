/**
 * 固定回放基准（bench）的多轮对话集：给延迟/缓存命中率等指标做
 * "改动前 vs 改动后"对比用。工作负载固定且贴近日常使用比例，
 * 比自然流量公平（自然流量一周多一周少、构成不一，前后不可比）。
 *
 * - 25 段对话 × 每段 2-4 轮，覆盖：记餐(8)、晚饭计划(6)、入库(4)、
 *   查库存(3)、周计划(2)、反馈(2)——按个人日常使用的大致比例。
 * - 每段一个独立合成用户（bench_ 前缀），setup 用固定种子预置
 *   画像与库存；执行方负责清库重建，保证任何机器上负载一致。
 * - 对话内容是自然语言，不针对工具调用写"提示词工程"——基准要
 *   测的是日常话术下的真实延迟与缓存行为。
 */
export type BenchCategory =
  | "meal_log"
  | "dinner_plan"
  | "restock"
  | "inventory_check"
  | "weekly_plan"
  | "feedback";

export interface BenchSetup {
  allergies?: string[];
  avoidFoods?: string[];
  availableIngredients?: string[];
}

export interface BenchConversation {
  id: string;
  category: BenchCategory;
  userId: string;
  turns: string[];
  setup: BenchSetup;
  /** meal_log 类：用户在对话中明确提到要记录的食物（落库率指标的分母）。 */
  expectedFoods?: string[];
}

const conversation = (
  id: string,
  category: BenchCategory,
  turns: string[],
  setup: BenchSetup = {},
  expectedFoods?: string[],
): BenchConversation => ({ id, category, userId: `bench_${id}`, turns, setup, ...(expectedFoods ? { expectedFoods } : {}) });

/**
 * 落库率匹配：expected 里的食物是否出现在任一日志条目里。
 * 双向子串（"煮鸡蛋"↔"鸡蛋"）；叫法完全不同的（如"泡面"↔"方便面"）
 * 会被记为 missed，由人工在结果文件里复核。
 */
export function matchPersistedFoods(
  expected: readonly string[],
  logs: readonly { foods: readonly { name: string }[] }[],
): { persisted: string[]; missed: string[] } {
  const loggedNames = logs.flatMap((log) => log.foods.map((food) => food.name));
  const persisted: string[] = [];
  const missed: string[] = [];
  for (const food of expected) {
    const hit = loggedNames.some((name) => name.includes(food) || food.includes(name));
    (hit ? persisted : missed).push(food);
  }
  return { persisted, missed };
}

export const BENCH_CONVERSATIONS: readonly BenchConversation[] = [
  // ---- 记餐（8）：日常占比最高，单轮快、追问汇总 ----
  conversation("log01", "meal_log", [
    "我早餐吃了燕麦粥和一个煮鸡蛋",
    "再来一杯无糖酸奶",
    "今天早餐一共大概多少热量？",
  ], {}, ["燕麦粥", "煮鸡蛋", "无糖酸奶"]),
  conversation("log02", "meal_log", [
    "午餐吃了番茄炒蛋和一碗米饭",
    "下午加餐吃了一个苹果，记一下",
  ], {}, ["番茄炒蛋", "米饭", "苹果"]),
  conversation("log03", "meal_log", [
    "晚饭吃了外卖：一份宫保鸡丁和一碗米饭",
    "把这顿记成今天的晚餐",
    "今天总共记录了多少热量？",
  ], {}, ["宫保鸡丁", "米饭"]),
  conversation("log04", "meal_log", [
    "我中午在食堂吃了清蒸鲈鱼、炒青菜和一小碗米饭",
    "鱼大概半条",
  ], {}, ["清蒸鲈鱼", "炒青菜", "米饭"]),
  conversation("log05", "meal_log", [
    "早上喝了一杯拿铁，帮我记一下",
    "早餐还吃了两片全麦面包",
  ], {}, ["拿铁", "全麦面包"]),
  conversation("log06", "meal_log", [
    "昨天夜宵吃了一包泡面，补记到昨天",
    "今天早上没吃东西，不用记早餐",
  ], {}, ["泡面"]),
  conversation("log07", "meal_log", [
    "我晚餐吃了土豆炖牛腩，分量挺大",
    "再补记一碗米饭",
    "今天蛋白质摄入够了吗？",
  ], {}, ["土豆炖牛腩", "米饭"]),
  conversation("log08", "meal_log", [
    "早餐喝了一杯豆浆，吃了一根油条",
    "中午还没吃，等会儿再说",
  ], {}, ["豆浆", "油条"]),

  // ---- 晚饭计划（6）：多轮收敛，含过敏/忌口/低能量分支 ----
  conversation("plan01", "dinner_plan", [
    "今晚想自己做饭，库存里有鸡腿和番茄",
    "20 分钟内能搞定的方案有哪些？",
    "第一个方案的详细时间线说一下",
  ], { availableIngredients: ["鸡腿", "番茄", "土豆", "洋葱", "米饭"] }),
  conversation("plan02", "dinner_plan", [
    "我对虾过敏，帮我安排今晚的晚饭",
    "换个洗碗少的方案",
  ], { allergies: ["虾"], availableIngredients: ["豆腐", "青菜", "牛肉", "洋葱"] }),
  conversation("plan03", "dinner_plan", [
    "我今天很累，不想在厨房久站",
    "家里有面条和鸡蛋吗？没有就推荐最省事的",
  ], { availableIngredients: ["面条", "青菜", "鸡蛋"] }),
  conversation("plan04", "dinner_plan", [
    "今晚两个人吃，推荐两道菜",
    "我不吃辣，都别放辣椒",
  ], { avoidFoods: ["辣椒"] }),
  conversation("plan05", "dinner_plan", [
    "冰箱里有西兰花和鸡胸肉，想吃得清淡点",
    "总时长控制在半小时以内",
  ], { availableIngredients: ["鸡胸肉", "西兰花", "胡萝卜"] }),
  conversation("plan06", "dinner_plan", [
    "今晚想吃面",
    "用库存里的面条能做什么？加个荷包蛋",
  ], { availableIngredients: ["面条", "小葱", "生抽", "鸡蛋"] }),

  // ---- 入库（4）：买完菜随手记 ----
  conversation("stock01", "restock", [
    "我刚买了番茄、鸡蛋、牛肉和一把小葱，帮我入库",
    "牛肉放冷冻，其他放冷藏",
  ]),
  conversation("stock02", "restock", [
    "昨天订的牛奶和酸奶到了，帮我入库",
    "牛奶这几天会过期吗？",
  ]),
  conversation("stock03", "restock", [
    "买了一袋大米和一瓶生抽，入库",
    "生抽开瓶后放哪里比较好？",
  ]),
  conversation("stock04", "restock", [
    "朋友送了一盒草莓，帮我记到库存",
    "再补两根香蕉",
  ]),

  // ---- 查库存（3）：先看再决定 ----
  conversation("inv01", "inventory_check", [
    "我库存里现在有什么？",
    "用这些能做什么菜？推荐一个今晚做",
  ], { availableIngredients: ["土豆", "青椒", "猪肉", "洋葱"] }),
  conversation("inv02", "inventory_check", [
    "帮我看看有什么快过期的要先吃",
    "那今晚就先用它们做晚饭吧",
  ], { availableIngredients: ["鸡蛋", "番茄", "面条", "青菜"] }),
  conversation("inv03", "inventory_check", [
    "照着常做的菜，我这周还缺哪些食材？",
    "帮我生成一份采购清单",
  ], { availableIngredients: ["鸡胸肉", "西兰花", "蘑菇", "胡萝卜"] }),

  // ---- 周计划（2） ----
  conversation("week01", "weekly_plan", [
    "帮我安排下周的晚饭计划，一个人吃",
    "周五要加班晚归，那天换个快手的",
    "周二那天的菜换一下",
  ]),
  conversation("week02", "weekly_plan", [
    "安排这周七天的晚餐，我对花生过敏",
    "周末两天想做点稍有仪式感的",
  ], { allergies: ["花生"] }),

  // ---- 反馈（2） ----
  conversation("fb01", "feedback", [
    "昨天做的番茄鸡蛋面挺好吃，下次还做",
    "就是切番茄花了点时间",
  ]),
  conversation("fb02", "feedback", [
    "上次那个蒜蓉粉丝蒸虾太麻烦了，下次别推荐了",
    "帮我记住这个反馈",
  ]),
];

if (BENCH_CONVERSATIONS.length !== 25) {
  throw new Error(`Expected 25 bench conversations; got ${BENCH_CONVERSATIONS.length}`);
}
