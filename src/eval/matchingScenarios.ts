/**
 * 匹配评测 v2：20 个库存场景，每个标注"可接受集合"（5-8 道，含时间/厨具/设备约束）。
 * 指标 = Precision@3（算法 Top3 中有多少道在可接受集合里）。
 * 标注由 LLM 起草、待人工扫审（data/eval/matching-review.md）；修复前后各跑一次对比。
 */

export interface MatchingScenario {
  id: string;
  description: string;
  availableIngredients: string[];
  /** 厨房约束（匹配算法同时考虑时间/厨具/设备） */
  kitchen: { burners: number; hasOven: boolean; hasMicrowave: boolean; hasRiceCooker: boolean; cookware: string[]; maxActiveMinutes: number; maxTotalMinutes: number };
  /** 可接受集合（5-8 道，标注时考虑库存+时间/厨具/设备；菜名须在 187 道库内） */
  acceptable: string[];
  /**
   * 家庭多人（PR E）：用餐成员与"谁吃"。"我"=画像过敏 [] + 厨房口味；
   * 物理成员各带过敏/忌口/口味。不传 dining = 全员；显式列表 = 指定谁吃
   * （成员名或"我"；不含"我"时厨房口味不参与）。acceptable 标注需按并集
   * 过滤 + 成员口味加权双重口径复核（草案由 LLM 起草，人工冻结）。
   */
  household?: {
    members: Array<{ name: string; allergies?: string[]; avoidFoods?: string[]; preferences?: string[] }>;
    dining?: string[];
  };
}

const defaultKitchen = { burners: 2, hasOven: true, hasMicrowave: true, hasRiceCooker: true, cookware: ["炒锅", "汤锅", "碗", "盘", "烤盘", "平底锅", "保鲜袋", "电饭煲"], maxActiveMinutes: 40, maxTotalMinutes: 90 };
const noOven = { ...defaultKitchen, hasOven: false, cookware: ["炒锅", "汤锅", "碗", "盘", "平底锅"] };
const quickOnly = { ...defaultKitchen, maxActiveMinutes: 20, maxTotalMinutes: 35 };

export const MATCHING_SCENARIOS: readonly MatchingScenario[] = [
  // ---- 少量库存 ----
  {
    id: "sc_01", description: "只有鸡蛋和番茄", availableIngredients: ["鸡蛋", "番茄"], kitchen: defaultKitchen,
    acceptable: ["番茄炒蛋", "番茄鸡蛋面", "蒸蛋羹", "紫菜蛋花汤", "蘑菇蛋花汤", "快手白粥配小菜"],
  },
  {
    id: "sc_02", description: "土豆胡萝卜", availableIngredients: ["土豆", "胡萝卜"], kitchen: defaultKitchen,
    acceptable: ["咖喱鸡块", "素炒面", "青椒土豆炒肉", "排骨炖土豆", "烤鸡腿土豆", "土豆胡萝卜牛肉烤盘"],
  },
  {
    id: "sc_03", description: "一块豆腐", availableIngredients: ["豆腐"], kitchen: defaultKitchen,
    acceptable: ["凉拌豆腐", "豆腐青菜汤", "皮蛋豆腐", "葱烧豆腐", "番茄豆腐一锅炖", "虾仁鸡蛋滑豆腐"],
  },
  // ---- 临期食材 ----
  {
    id: "sc_04", description: "冰箱清仓：青菜土豆都要过期", availableIngredients: ["青菜", "土豆"], kitchen: defaultKitchen,
    acceptable: ["素炒面", "蒜蓉西兰花", "排骨炖土豆", "烤鸡腿土豆", "土豆胡萝卜牛肉烤盘", "冷冻饺子青菜汤"],
  },
  {
    id: "sc_05", description: "鸡蛋快过期（+米饭葱）", availableIngredients: ["鸡蛋", "米饭", "葱"], kitchen: defaultKitchen,
    acceptable: ["蛋炒饭", "番茄炒蛋", "蒸蛋羹", "紫菜蛋花汤", "番茄鸡蛋面", "快手白粥配小菜"],
  },
  // ---- 单一蛋白 ----
  {
    id: "sc_06", description: "只买了鸡腿（+姜蒜）", availableIngredients: ["鸡腿", "姜", "蒜"], kitchen: defaultKitchen,
    acceptable: ["可乐鸡翅", "宫保鸡丁", "香菇滑鸡", "酱油鸡", "口水鸡", "烤鸡腿土豆", "小酥肉"],
  },
  {
    id: "sc_07", description: "牛肉爱好者（肥牛洋葱青椒）", availableIngredients: ["肥牛", "洋葱", "青椒"], kitchen: defaultKitchen,
    acceptable: ["肥牛洋葱盖饭", "青椒土豆炒肉", "农家一碗香", "青椒牛肉快炒", "回锅肉", "鱼香肉丝"],
  },
  // ---- 全配库存 ----
  {
    id: "sc_08", description: "标准四人晚餐库存", availableIngredients: ["鸡腿", "土豆", "西兰花", "番茄", "豆腐", "青菜", "洋葱"], kitchen: defaultKitchen,
    acceptable: ["咖喱鸡块", "番茄豆腐一锅炖", "蒜蓉西兰花", "烤鸡腿土豆", "豆腐青菜汤", "番茄炒蛋", "香菇滑鸡"],
  },
  {
    id: "sc_09", description: "面食爱好者", availableIngredients: ["面条", "小葱", "生抽", "老抽", "猪油", "青菜"], kitchen: defaultKitchen,
    acceptable: ["阳春面", "葱油拌面", "素炒面", "番茄鸡蛋面", "豆角焖面", "猪油拌饭"],
  },
  {
    id: "sc_10", description: "家常菜全配", availableIngredients: ["五花肉", "蒜苗", "青椒", "豆瓣酱", "猪里脊", "米饭"], kitchen: defaultKitchen,
    acceptable: ["回锅肉", "鱼香肉丝", "农家一碗香", "香煎五花肉", "青椒土豆炒肉", "小炒鸡肝"],
  },
  // ---- 主食 ----
  {
    id: "sc_11", description: "冷饭剩菜", availableIngredients: ["米饭", "鸡蛋", "火腿", "黄瓜", "胡萝卜"], kitchen: defaultKitchen,
    acceptable: ["蛋炒饭", "可乐炒饭", "蔬菜鸡蛋粥", "番茄酱蛋包饭", "快手白粥配小菜", "卤肉饭"],
  },
  {
    id: "sc_12", description: "粥品早餐", availableIngredients: ["大米", "皮蛋", "猪肉"], kitchen: defaultKitchen,
    acceptable: ["皮蛋瘦肉粥", "快手白粥配小菜", "桂圆红枣粥", "蔬菜鸡蛋粥", "卤肉饭"],
  },
  // ---- 汤 ----
  {
    id: "sc_13", description: "想喝汤", availableIngredients: ["番茄", "鸡蛋", "豆腐", "青菜"], kitchen: defaultKitchen,
    acceptable: ["番茄豆腐一锅炖", "豆腐青菜汤", "紫菜蛋花汤", "蘑菇蛋花汤", "番茄炒蛋", "蒸蛋羹"],
  },
  {
    id: "sc_14", description: "海鲜汤（虾+姜葱豆腐）", availableIngredients: ["基围虾", "姜", "葱", "豆腐"], kitchen: defaultKitchen,
    acceptable: ["白灼虾", "蒜蓉粉丝蒸虾", "花蛤豆腐汤", "虾仁鸡蛋滑豆腐", "葱烧豆腐"],
  },
  // ---- 快手/低能量 ----
  {
    id: "sc_15", description: "下班很累只想快手（active≤20min）", availableIngredients: ["鸡蛋", "面条", "葱"], kitchen: quickOnly,
    acceptable: ["阳春面", "葱油拌面", "番茄鸡蛋面", "蒸蛋羹", "快手白粥配小菜", "太阳蛋"],
  },
  {
    id: "sc_16", description: "微波炉党（有微波无烤箱）", availableIngredients: ["鸡蛋", "米饭", "玉米粒"], kitchen: noOven,
    acceptable: ["蛋炒饭", "太阳蛋", "微波炉蒸蛋", "番茄酱蛋包饭", "金枪鱼玉米饭团", "快手白粥配小菜"],
  },
  // ---- 素食 ----
  {
    id: "sc_17", description: "素食者", availableIngredients: ["豆腐", "青菜", "土豆", "胡萝卜", "木耳"], kitchen: defaultKitchen,
    acceptable: ["素炒面", "凉拌豆腐", "豆腐青菜汤", "土豆胡萝卜牛肉烤盘", "蒜蓉西兰花", "葱烧豆腐"],
  },
  // ---- 特殊 ----
  {
    id: "sc_18", description: "三明治早餐", availableIngredients: ["吐司", "鸡蛋", "生菜", "番茄", "芝士片"], kitchen: defaultKitchen,
    acceptable: ["鸡蛋三明治", "太阳蛋", "苏格兰蛋", "番茄炒蛋", "蒸蛋羹"],
  },
  {
    id: "sc_19", description: "火锅底料清仓", availableIngredients: ["火锅底料", "五花肉", "青菜", "豆腐", "土豆"], kitchen: defaultKitchen,
    acceptable: ["麻辣香锅", "水油焖蔬菜", "番茄豆腐一锅炖", "豆腐青菜汤", "排骨炖土豆"],
  },
  {
    id: "sc_20", description: "金枪鱼罐头还能做什么", availableIngredients: ["金枪鱼罐头", "玉米粒", "米饭", "海苔"], kitchen: defaultKitchen,
    acceptable: ["金枪鱼玉米饭团", "蛋炒饭", "可乐炒饭", "快手白粥配小菜", "卤肉饭"],
  },
];

// ---- 家庭多人（PR E）：并集过滤 + 口味加权（acceptable 为 LLM 起草草案，待人工复核后冻结 v0） ----
export const FAMILY_MATCHING_SCENARIOS: readonly MatchingScenario[] = [
  {
    id: "fam_sc_01", description: "小明过敏虾：全员用餐，虾菜全部出局",
    availableIngredients: ["虾仁", "鸡蛋", "番茄", "青菜", "面条", "鸡腿", "米饭"], kitchen: defaultKitchen,
    household: { members: [{ name: "小明", allergies: ["虾"] }] },
    acceptable: ["番茄炒蛋", "番茄鸡蛋面", "酱油鸡", "蔬菜鸡蛋粥"],
  },
  {
    id: "fam_sc_02", description: "小明过敏花生、小红忌口香菜：双重并集",
    availableIngredients: ["鸡腿", "土豆", "西兰花", "番茄", "豆腐", "青菜", "洋葱"], kitchen: defaultKitchen,
    household: { members: [{ name: "小明", allergies: ["花生"] }, { name: "小红", avoidFoods: ["香菜"] }] },
    acceptable: ["番茄豆腐一锅炖", "蒜蓉西兰花", "烤鸡腿土豆", "豆腐青菜汤"],
  },
  {
    id: "fam_sc_03", description: "小明过敏虾但今晚不在：虾菜恢复可用（过滤按在场成员）",
    availableIngredients: ["虾仁", "鸡蛋", "番茄", "青菜", "面条", "鸡腿", "米饭"], kitchen: defaultKitchen,
    household: { members: [{ name: "小明", allergies: ["虾"] }], dining: ["我"] },
    acceptable: ["番茄炒蛋", "蒸蛋羹", "番茄鸡蛋面", "蔬菜鸡蛋粥"],
  },
  {
    // v0：库存为三道辣菜（宫保鸡丁/农家一碗香/回锅肉）配齐必需食材。
    // v1：加茄子/纯瘦肉/柠檬，让地三鲜、瘦肉土豆片、柠檬香煎鸡胸三道非辣菜同样可做
    // （食材可得性与辣菜对齐——v0 对照实验显示口味加成只改分值不改排序，场景在测
    // 食材匹配；v1 让辣/非辣只在口味上有区别，对照轮去掉偏好后区分度应来自口味）。
    // 对照实验：去掉小明的口味偏好重跑，观察 Top3 是否被非辣菜挤占；两轮结果见
    // data/eval/matching-family-proposals{,-no-taste}.json。
    id: "fam_sc_04", description: "小明爱辣：辣菜与非辣菜食材同样齐全，只靠口味加权分高下",
    availableIngredients: ["鸡胸肉", "花生", "干辣椒", "青椒", "五花肉", "蒜苗", "豆瓣酱", "小米椒", "米饭", "青菜", "鸡腿", "土豆", "茄子", "纯瘦肉", "柠檬"], kitchen: defaultKitchen,
    household: { members: [{ name: "小明", preferences: ["辣"] }] },
    acceptable: ["宫保鸡丁", "农家一碗香", "回锅肉"],
  },
];
