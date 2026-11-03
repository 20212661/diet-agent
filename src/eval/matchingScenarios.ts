/**
 * 匹配评测：20 个库存场景，每个标注期望的前 3 道菜（LLM 起草、待人工扫）。
 * 场景覆盖：少量库存、临期食材、单一蛋白、多库存全配、季节性等。
 * 期望菜 = 从 187 道库中按"库存匹配度最高+合理推荐"人工推演（LLM），
 * 修复前后各跑一次命中率对比。
 */

export interface MatchingScenario {
  id: string;
  description: string;
  availableIngredients: string[];
  /** 期望前 3（LLM 起草，人工扫审用；菜名须精确匹配库内菜名） */
  expectedTop3: string[];
}

export const MATCHING_SCENARIOS: readonly MatchingScenario[] = [
  // 少量库存（3-4 样）
  { id: "sc_01", description: "只有鸡蛋和番茄", availableIngredients: ["鸡蛋", "番茄"], expectedTop3: ["番茄炒蛋", "番茄鸡蛋面", "蛋炒饭"] },
  { id: "sc_02", description: "土豆胡萝卜", availableIngredients: ["土豆", "胡萝卜"], expectedTop3: ["咖喱鸡块", "素炒面", "土豆炖牛腩"] },
  { id: "sc_03", description: "一块豆腐", availableIngredients: ["豆腐"], expectedTop3: ["凉拌豆腐", "豆腐青菜汤", "皮蛋豆腐"] },
  // 临期食材
  { id: "sc_04", description: "冰箱清仓：青菜土豆都要过期", availableIngredients: ["青菜", "土豆"], expectedTop3: ["素炒面", "蒜蓉西兰花", "葱油拌面"] },
  { id: "sc_05", description: "鸡蛋快过期", availableIngredients: ["鸡蛋", "米饭", "葱"], expectedTop3: ["蛋炒饭", "番茄炒蛋", "蒸蛋羹"] },
  // 单一蛋白
  { id: "sc_06", description: "只买了鸡腿", availableIngredients: ["鸡腿", "姜", "蒜"], expectedTop3: ["可乐鸡翅", "宫保鸡丁", "小酥肉"] },
  { id: "sc_07", description: "牛肉爱好者", availableIngredients: ["肥牛", "洋葱", "青椒"], expectedTop3: ["肥牛洋葱盖饭", "青椒土豆炒肉", "农家一碗香"] },
  // 全配库存（bench 常见）
  { id: "sc_08", description: "标准四人晚餐库存", availableIngredients: ["鸡腿", "土豆", "西兰花", "番茄", "豆腐", "青菜", "洋葱"], expectedTop3: ["咖喱鸡块", "番茄豆腐一锅炖", "蒜蓉西兰花"] },
  { id: "sc_09", description: "面食爱好者", availableIngredients: ["面条", "小葱", "生抽", "老抽", "猪油", "青菜"], expectedTop3: ["阳春面", "葱油拌面", "素炒面"] },
  { id: "sc_10", description: "家常菜全配", availableIngredients: ["五花肉", "蒜苗", "青椒", "豆瓣酱", "猪里脊", "米饭"], expectedTop3: ["回锅肉", "鱼香肉丝", "农家一碗香"] },
  // 主食场景
  { id: "sc_11", description: "冷饭剩菜", availableIngredients: ["米饭", "鸡蛋", "火腿", "黄瓜", "胡萝卜"], expectedTop3: ["蛋炒饭", "可乐炒饭", "扬州炒饭"] },
  { id: "sc_12", description: "粥品早餐", availableIngredients: ["大米", "皮蛋", "猪肉"], expectedTop3: ["皮蛋瘦肉粥", "快手白粥配小菜", "桂圆红枣粥"] },
  // 汤类
  { id: "sc_13", description: "想喝汤", availableIngredients: ["番茄", "鸡蛋", "豆腐", "青菜"], expectedTop3: ["番茄豆腐一锅炖", "豆腐青菜汤", "紫菜蛋花汤"] },
  { id: "sc_14", description: "海鲜汤", availableIngredients: ["基围虾", "姜", "葱", "豆腐"], expectedTop3: ["白灼虾", "蒜蓉粉丝蒸虾", "花蛤豆腐汤"] },
  // 快手/低能量
  { id: "sc_15", description: "下班很累只想快手", availableIngredients: ["鸡蛋", "面条", "葱"], expectedTop3: ["阳春面", "葱油拌面", "番茄鸡蛋面"] },
  { id: "sc_16", description: "微波炉党", availableIngredients: ["鸡蛋", "米饭", "玉米粒"], expectedTop3: ["蛋炒饭", "太阳蛋", "微波炉蒸蛋"] },
  // 素食
  { id: "sc_17", description: "素食者", availableIngredients: ["豆腐", "青菜", "土豆", "胡萝卜", "木耳"], expectedTop3: ["素炒面", "凉拌豆腐", "地三鲜"] },
  // 特殊
  { id: "sc_18", description: "三明治早餐", availableIngredients: ["吐司", "鸡蛋", "生菜", "番茄", "芝士片"], expectedTop3: ["鸡蛋三明治", "太阳蛋", "苏格兰蛋"] },
  { id: "sc_19", description: "火锅底料清仓", availableIngredients: ["火锅底料", "五花肉", "青菜", "豆腐", "土豆"], expectedTop3: ["麻辣香锅", "水油焖蔬菜", "番茄豆腐一锅炖"] },
  { id: "sc_20", description: "金枪鱼罐头还能做什么", availableIngredients: ["金枪鱼罐头", "玉米粒", "米饭", "海苔"], expectedTop3: ["金枪鱼玉米饭团", "蛋炒饭", "可乐炒饭"] },
];
