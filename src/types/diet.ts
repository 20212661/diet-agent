/**
 * 饮食管理智能体 - 核心数据类型定义
 */
import { isValidIsoDate } from "../utils/date.js";

/** 用户目标类型 */
export type UserGoal =
  | "fat_loss"
  | "muscle_gain"
  | "maintain"
  | "healthier_eating"
  | "custom";

/** 活动水平 */
export type ActivityLevel = "low" | "medium" | "high";

/** 餐次类型 */
export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "unknown";

/** 用户饮食画像 */
export interface UserProfile {
  userId: string;
  goal?: UserGoal;
  customGoal?: string;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  gender?: string;
  activityLevel?: ActivityLevel;
  avoidFoods?: string[];
  preferences?: string[];
  allergies?: string[];
  medicalNotes?: string[];
  createdAt: string;
  updatedAt: string;
}

/** 单项食物记录 */
export interface NutritionEstimate {
  status: "verified" | "range" | "unavailable";
  calories?: number;
  lowerCalories?: number;
  upperCalories?: number;
  foodName: string;
  amount: number;
  unit: string;
  grams?: number;
  cookingMethod: string;
  source: string;
  sourceRecordId: string;
  sourceVersion: string;
}

export interface MealFood {
  name: string;
  amount: string;
  nutrition?: NutritionEstimate;
  /** @deprecated Legacy untraceable value; never display or include in totals. */
  estimatedCalories?: number;
  note?: string;
}

/** 一餐记录 */
export interface MealLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  operationId?: string;
  mealType: MealType;
  foods: MealFood[];
  note?: string;
  createdAt: string;
  deletedAt?: string;
}

/** 今日饮食总结 */
export interface TodaySummary {
  userId: string;
  date: string;
  meals: MealLog[];
  estimatedTotalCalories?: number;
  summaryText: string;
}

/** 更新用户画像的输入参数 */
export interface UpdateUserProfileInput {
  userId: string;
  goal?: UserGoal;
  customGoal?: string;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  gender?: string;
  activityLevel?: ActivityLevel;
  avoidFoods?: string[];
  preferences?: string[];
  allergies?: string[];
  medicalNotes?: string[];
}

/** 添加饮食记录的输入参数 */
export interface AddMealLogInput {
  userId: string;
  operationId?: string;
  date?: string;
  mealType: MealType;
  foods: MealFood[];
  note?: string;
}

export interface UpdateMealLogInput {
  userId: string;
  operationId: string;
  mealLogId: string;
  date?: string;
  mealType?: MealType;
  foods?: MealFood[];
  note?: string;
}

export type EnergyLevel = "low" | "normal";

export interface KitchenProfile {
  userId: string;
  burners: number;
  hasOven: boolean;
  hasMicrowave: boolean;
  hasRiceCooker: boolean;
  cookware: string[];
  maxActiveMinutes: number;
  maxTotalMinutes: number;
  tastePreferences: string[];
  cookingPreferences: string[];
  updatedAt: string;
}

export interface IngredientItem {
  id?: string;
  name: string;
  amount?: string;
  unit?: string;
  category?: "protein" | "vegetable" | "staple" | "seasoning" | "dairy" | "fruit" | "other";
  storage?: "fridge" | "freezer" | "pantry" | "room_temp";
  status?: IngredientStatus;
  expiresAt?: string; // YYYY-MM-DD
  purchasedAt?: string; // YYYY-MM-DD
  expiresSoon?: boolean;
  /** Computed from expiresAt using the local calendar date. */
  isExpired?: boolean;
  /** Computed from status by the inventory repository. */
  isAvailable?: boolean;
  note?: string;
}

export type IngredientStatus = "available" | "planned" | "used" | "expired" | "discarded";

/** The single availability rule used by inventory and recipe selection. */
export function isExpired(item: Pick<IngredientItem, "expiresAt">): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return isExpiredOn(item, today);
}

export function isExpiredOn(item: Pick<IngredientItem, "expiresAt">, date: string): boolean {
  return Boolean(item.expiresAt && (!isValidIsoDate(item.expiresAt) || item.expiresAt < date));
}

export function isAvailable(item: Pick<IngredientItem, "status"> & Pick<IngredientItem, "expiresAt">): boolean {
  return (item.status === undefined || item.status === "available") && !isExpired(item);
}

export function isAvailableOn(item: Pick<IngredientItem, "status" | "expiresAt">, date: string): boolean {
  return (item.status === undefined || item.status === "available") && !isExpiredOn(item, date);
}

export interface IngredientInventory {
  userId: string;
  availableIngredients: IngredientItem[];
  shoppingList: IngredientItem[];
  updatedAt: string;
}

export interface CookingPlanRequest {
  userId: string;
  availableIngredients?: string[];
  shoppingList?: string[];
  timeLimitMinutes?: number;
  energyLevel?: EnergyLevel;
  desiredStyle?: string;
}

/** 做饭反馈 */
export interface CookingFeedback {
  id: string;
  userId: string;
  recipeId?: string;
  recipeName?: string;
  rating?: number;
  actualActiveMinutes?: number;
  actualTotalMinutes?: number;
  tooTiring?: boolean;
  tooManyDishes?: boolean;
  wouldCookAgain?: boolean;
  note?: string;
  createdAt: string;
}

/** 菜谱餐次类型 */
export type RecipeMealType = "breakfast" | "lunch" | "dinner" | "snack";

/** 菜谱烹饪模式 */
export type RecipeMode =
  | "quick"
  | "oven"
  | "stovetop"
  | "one_pot"
  | "low_energy"
  | "prep"
  | "freezer_reuse";

/** 菜谱所需电器 */
export type RecipeAppliance = "oven" | "stove" | "microwave" | "rice_cooker";

/** 规范化过敏原 ID */
export type AllergenId =
  | "peanut"
  | "tree_nut"
  | "milk"
  | "egg"
  | "soy"
  | "wheat"
  | "gluten"
  | "fish"
  | "shellfish"
  | "sesame";

/** 菜谱（数据库存储版） */
export interface RecipeRecord {
  id: string;
  name: string;

  /** 旧兼容字段，新代码优先使用 modes */
  mode: string;
  /** 结构化烹饪模式 */
  mealTypes: RecipeMealType[];
  /** 结构化烹饪模式列表 */
  modes: RecipeMode[];
  /** 适合的饮食目标 */
  suitableGoals: string[];

  /** 必须食材 */
  ingredients: string[];
  /** 可选食材 */
  optionalIngredients: string[];
  /** 必须和可选食材归一化后的稳定 ID */
  ingredientIds: string[];
  /** 从全部食材推导出的结构化过敏原标签 */
  allergenTags: AllergenId[];

  /** 主要蛋白质来源 */
  primaryProtein?: string;
  /** 包含的蔬菜 */
  vegetables: string[];
  /** 包含的主食 */
  staples: string[];

  /** 所需厨具 */
  cookware: string[];
  /** 所需电器 */
  appliances: RecipeAppliance[];

  /** 主动操作时间（分钟） */
  activeMinutes: number;
  /** 总耗时（分钟） */
  totalMinutes: number;
  /** 难度 1-5 */
  difficulty: number;
  /** 碗碟数 1-5 */
  dishCount: number;

  /** 口味标签 */
  tasteTags: string[];
  /** 偏好标签 */
  preferenceTags: string[];
  /** 季节标签 */
  seasonTags?: string[];

  /** 详细步骤 */
  steps: string[];
  /** 分钟级时间线 */
  timeline?: string[];

  /** 低能量替换方案 */
  lowEnergySwap?: string;
  /** 周末备菜建议 */
  weekendPrep?: string;
  /** 冷冻复用建议 */
  freezerReuse?: string;

  /** 估算热量 kcal */
  nutrition?: NutritionEstimate;
  /** @deprecated Legacy untraceable value; never display or include in matching. */
  estimatedCalories?: number;
  /** 蛋白质水平 */
  proteinLevel?: "low" | "medium" | "high";

  updatedAt: string;
}

/** 一周计划中单日的条目 */
export interface WeeklyDayPlan {
  /** 星期几：1=周一, 2=周二, ..., 7=周日 */
  dayOfWeek: number;
  /** 日期字符串 YYYY-MM-DD */
  date: string;
  /** 主菜菜谱摘要 */
  mainRecipe: {
    id: string;
    name: string;
    activeMinutes: number;
    totalMinutes: number;
    nutrition?: NutritionEstimate;
    /** @deprecated Legacy untraceable value; never display. */
    estimatedCalories?: number;
  };
  /** 配菜菜谱摘要（可选） */
  sideRecipe?: {
    id: string;
    name: string;
    activeMinutes: number;
    totalMinutes: number;
  };
  /** 主食建议 */
  staplesSuggestion: string;
  /** 推荐理由 */
  reasons: string[];
  /** Required ingredients absent from owned inventory, including items already on the shopping list. */
  missingIngredients: string[];
  /** Required ingredient state: owned, already on the shopping list, or still to add. */
  ingredientReadiness?: IngredientReadiness[];
  /** Explicit user action for this exact main recipe. */
  completed: boolean;
  /** Informational only: an active dinner log exists for this date. */
  hasDinnerLog?: boolean;
  completedAt?: string;
  /** Revalidated against the current profile and kitchen each time a plan is read. */
  executionBlockedReason?: string;
}

/** 一周菜单计划 */
export interface WeeklyPlan {
  userId: string;
  /** 本周开始日期 (YYYY-MM-DD, Monday) */
  weekStartDate: string;
  /** 7 天计划条目 */
  days: WeeklyDayPlan[];
  /** 计划状态 */
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface IngredientReadiness {
  ingredient: string;
  status: "owned" | "already_on_list" | "to_add_to_list";
  /** Inventory quantities are free text, so presence never verifies the recipe quantity. */
  quantityVerified?: false;
}

/** A single planned meal, backed by a recipe or a conservative fallback template. */
export interface PlannedMeal {
  mealType: Exclude<MealType, "unknown">;
  source: "recipe" | "template" | "unavailable";
  executionBlockedReason?: string;
  appliances?: RecipeAppliance[];
  cookware?: string[];
  name: string;
  recipeId?: string;
  ingredients: string[];
  activeMinutes?: number;
  totalMinutes?: number;
  missingIngredients: string[];
  reasons: string[];
  nutrition?: NutritionEstimate;
}

export interface MealPlanDay {
  date: string;
  meals: PlannedMeal[];
}

export interface MealPlanConstraints {
  temporaryAvoidFoods: string[];
  timeLimitMinutes: number;
  energyLevel: EnergyLevel;
  preferredStyles: string[];
}

/** Persisted one-to-seven-day meal plan. */
export interface MealPlan {
  userId: string;
  startDate: string;
  days: MealPlanDay[];
  target?: string;
  goal?: UserGoal;
  constraints?: MealPlanConstraints;
  createdAt: string;
  updatedAt: string;
}
