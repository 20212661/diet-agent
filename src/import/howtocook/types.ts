/**
 * HowToCook（github.com/Anduin2017/HowToCook，Unlicense）导入管道的类型。
 *
 * P1 阶段只做解析与漏斗统计，不入库；所有记录保留来源（路径 + 固定
 * commit），"预估卡路里"按营养数据规则直接丢弃，"计算"段的每份用量
 * 原样保留在 computeLines（后续做购物清单数量估算时用，先不消费）。
 */

export const HTC_CATEGORIES = [
  "aquatic",
  "breakfast",
  "meat_dish",
  "soup",
  "staple",
  "vegetable_dish",
] as const;

export type HtcCategory = (typeof HTC_CATEGORIES)[number];

export const HTC_CATEGORY_LABELS: Record<HtcCategory, string> = {
  aquatic: "水产",
  breakfast: "早餐",
  meat_dish: "荤菜",
  soup: "汤",
  staple: "主食",
  vegetable_dish: "素菜",
};

export interface HtcSourceRef {
  repo: string;
  commit: string;
  /** 相对源仓库根的路径，如 dishes/meat_dish/宫保鸡丁/宫保鸡丁.md */
  path: string;
}

/** 解析阶段的原始记录：食材/工具保持原文写法，规范化在后续阶段进行。 */
export interface HtcRawRecipe {
  name: string;
  category: HtcCategory;
  /** 1-5（星数） */
  difficulty: number;
  /** "必备原料和工具"段剥离厨具后的原文食材写法 */
  requiredItems: string[];
  /** "### 可选原料"段的原文写法（已剥离厨具） */
  optionalItems: string[];
  /** 厨具词表分离出的工具项（原文写法） */
  utensils: string[];
  /** "计算"段原样保留的每份用量行 */
  computeLines: string[];
  /** 所选版本的步骤（去序号） */
  steps: string[];
  /** 多版本操作时实际选择的版本标题 */
  chosenVariant: string | undefined;
  /** 原文操作段里的版本数（1 = 无子版本） */
  variantCount: number;
  /** 步骤文本中提到的分钟数合计（小时按 60 分钟折算）；提取不到为 undefined */
  stepMinutesTotal: number | undefined;
  source: HtcSourceRef;
}

export interface HtcParseResult {
  recipe: HtcRawRecipe | undefined;
  /** 解析问题（缺段、无食材、无步骤等），进入漏斗报告 */
  problems: string[];
}
