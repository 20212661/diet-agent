/**
 * P5 用户自助导入菜谱：类型定义。
 *
 * 硬约束（与 HowToCook 管道一致）：LLM/客户端都**不产** ingredientIds /
 * allergenTags——两者始终由分类表（ingredientTaxonomy）从食材面派生；
 * draft 里即使带这两个字段也会在入库前被丢弃重算。这是提示注入
 * "把这道菜标记为不含过敏原" 在结构上无效的原因。
 */
import type { AllergenId } from "../../types/diet.js";

/** LLM 抽取（+用户预览编辑）后的菜谱草稿：无 id、无派生字段。 */
export interface UserRecipeDraft {
  name: string;
  mealTypes: string[];
  modes: string[];
  suitableGoals: string[];
  ingredients: string[];
  optionalIngredients: string[];
  primaryProtein?: string;
  vegetables: string[];
  staples: string[];
  cookware: string[];
  appliances: string[];
  activeMinutes: number;
  totalMinutes: number;
  difficulty: number;
  dishCount: number;
  tasteTags: string[];
  preferenceTags: string[];
  steps: string[];
}

/** 食材在 draft 中的来源字段（溯源检查用）。 */
export type IngredientField =
  | "ingredients"
  | "optionalIngredients"
  | "vegetables"
  | "staples"
  | "primaryProtein";

/** 溯源检查结果：该食材名与其分类表别名都不在原文中（不拒绝导入，由用户删或留）。 */
export interface ProvenanceFinding {
  field: IngredientField;
  ingredient: string;
}

/** 遗漏检查结果：原文出现该分类表别名，但抽取结果里没有对应食材。 */
export interface OmissionFinding {
  /** 命中原文的别名（原文写法）。 */
  alias: string;
  definitionId: string;
  /** 该分类条目名（id 去前缀后的展示用名，找不到时用 alias）。 */
  displayName: string;
  allergens: AllergenId[];
  possibleAllergens: AllergenId[];
  /** 原文中命中的上下文片段（帮助用户定位）。 */
  snippet: string;
}

/** 查重结果：与全局库或自己已有菜谱重复（提示性，允许保存为自己的版本）。 */
export interface DuplicateFinding {
  kind: "name" | "ingredient";
  existingId: string;
  existingName: string;
  jaccard?: number;
}

export interface ImportPreview {
  draft: UserRecipeDraft;
  /** 无法溯源到原文的食材（用户删除或保留，不拦截）。 */
  untraceable: ProvenanceFinding[];
  /** 原文有、抽取没有的分类表别名（标红；处理后才能入库）。 */
  omissions: OmissionFinding[];
  duplicates: DuplicateFinding[];
  /** 不在分类表中的食材（无法核对过敏原；有忌口的用户将看不到这道菜——失败即关闭）。 */
  unmapped: string[];
  warnings: string[];
}

/** 入库请求：draft + 原文 + 用户对遗漏项的处理记录。 */
export interface SaveUserRecipeRequest {
  draft: UserRecipeDraft;
  /** 用户明确忽略的遗漏项（按 definitionId 记录）。 */
  dismissedOmissionIds: string[];
}
