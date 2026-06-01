/**
 * 饮食管理智能体 - 核心数据类型定义
 */

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
export interface MealFood {
  name: string;
  amount: string;
  estimatedCalories?: number;
  note?: string;
}

/** 一餐记录 */
export interface MealLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  mealType: MealType;
  foods: MealFood[];
  note?: string;
  createdAt: string;
}

/** 今日饮食总结 */
export interface TodaySummary {
  userId: string;
  date: string;
  meals: MealLog[];
  estimatedTotalCalories: number;
  foodsWithCalories: MealFood[];
  foodsWithoutCalories: MealFood[];
  coverageRatio: number;
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
  mealType: MealType;
  foods: MealFood[];
  note?: string;
}

export type EnergyLevel = "low" | "normal";

export interface KitchenProfile {
  userId: string;
  burners: number;
  hasOven: boolean;
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
  status?: "available" | "planned" | "used" | "expired" | "discarded";
  expiresAt?: string; // YYYY-MM-DD
  purchasedAt?: string; // YYYY-MM-DD
  expiresSoon?: boolean;
  note?: string;
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
export type RecipeMealType = "breakfast" | "lunch" | "dinner";

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
  estimatedCalories?: number;
  /** 蛋白质水平 */
  proteinLevel?: "low" | "medium" | "high";

  updatedAt: string;
}
