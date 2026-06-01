/**
 * 评分式菜谱匹配算法
 *
 * 根据食材、厨具、时间、用户偏好、饮食目标、反馈、忌口、低能量状态
 * 对菜谱进行多维度评分，输出排序结果及推荐理由。
 */

import type {
  RecipeRecord,
  IngredientItem,
  KitchenProfile,
  UserProfile,
  CookingFeedback,
  EnergyLevel,
} from "../types/diet.js";

// ---- 输入输出类型 ----

export interface MatchRecipeInput {
  recipes: RecipeRecord[];
  availableIngredients: IngredientItem[];
  shoppingList: IngredientItem[];
  kitchenProfile: KitchenProfile;
  userProfile?: UserProfile;
  feedback: CookingFeedback[];
  timeLimitMinutes?: number;
  energyLevel?: EnergyLevel;
  desiredStyle?: string;
}

export interface MatchRecipeResult {
  recipe: RecipeRecord;
  eligible: true;
  rejectedReasons: string[];
  score: number;
  scoreBreakdown: RecipeScoreBreakdown;
  reasons: string[];
  missingIngredients: string[];
}

export interface RecipeScoreBreakdown {
  ingredients: number;
  expiration: number;
  kitchen: number;
  time: number;
  preferences: number;
  goal: number;
  feedback: number;
  lowEnergy: number;
}

export interface RecipeEligibility {
  eligible: boolean;
  rejectedReasons: string[];
}

// ---- 工具函数 ----

/** 规范化食材名称用于模糊匹配 */
function norm(name: string): string {
  return name.toLowerCase().trim();
}

/** 判断 available 中是否有能匹配 ingredient 的项 */
function ingredientMatched(ingredient: string, available: string[]): boolean {
  const ing = norm(ingredient);
  return available.some((a) => {
    const na = norm(a);
    return na.includes(ing) || ing.includes(na);
  });
}

/** 判断 ingredient 是否在 avoid 列表中 */
function ingredientBlocked(ingredient: string, avoid: string[]): boolean {
  const ing = norm(ingredient);
  return avoid.some((a) => {
    const na = norm(a);
    return na.includes(ing) || ing.includes(na);
  });
}

/** 获取快过期的食材名称列表 */
function getExpiringNames(items: IngredientItem[]): string[] {
  return items.filter((item) => item.expiresSoon).map((item) => item.name);
}

/** 计算缺少的必需食材 */
function computeMissing(recipe: RecipeRecord, available: string[]): string[] {
  return recipe.ingredients.filter((ing) => !ingredientMatched(ing, available));
}

export function evaluateEligibility(
  recipe: RecipeRecord,
  kitchenProfile: KitchenProfile,
  userProfile?: UserProfile,
): RecipeEligibility {
  const rejectedReasons: string[] = [];
  const blockedFoods = [
    ...(userProfile?.avoidFoods ?? []),
    ...(userProfile?.allergies ?? []),
  ];
  const allRecipeFoods = [
    ...recipe.ingredients,
    ...(recipe.optionalIngredients ?? []),
    ...(recipe.vegetables ?? []),
  ];
  const blockedItems = allRecipeFoods.filter((ing) => ingredientBlocked(ing, blockedFoods));
  if (blockedItems.length > 0) {
    rejectedReasons.push(`包含忌口/过敏食材：${blockedItems.join("、")}`);
  }

  const appliances = recipe.appliances ?? [];
  if (appliances.includes("oven") && !kitchenProfile.hasOven) {
    rejectedReasons.push("需要烤箱但用户没有烤箱");
  }
  if (appliances.includes("stove") && kitchenProfile.burners < 1) {
    rejectedReasons.push("需要灶台但用户没有可用灶台");
  }

  const missingCookware = recipe.cookware.filter((cw) =>
    !kitchenProfile.cookware.some((kcw) =>
      norm(kcw).includes(norm(cw)) || norm(cw).includes(norm(kcw))
    )
  );
  if (missingCookware.length > 0) {
    rejectedReasons.push(`缺少厨具：${missingCookware.join("、")}`);
  }

  return { eligible: rejectedReasons.length === 0, rejectedReasons };
}

// ---- 主评分函数 ----

export function matchRecipes(input: MatchRecipeInput): MatchRecipeResult[] {
  const {
    recipes,
    availableIngredients,
    shoppingList,
    kitchenProfile,
    userProfile,
    feedback,
    timeLimitMinutes,
    energyLevel,
    desiredStyle,
  } = input;

  // 库存中实际拥有的食材名称
  const ownedNames = availableIngredients.map((i) => i.name);
  // 购物清单中的食材名称
  const shoppingNames = shoppingList.map((i) => i.name);
  // 所有的可用食材名称（库存 + 购物清单都可用于匹配）
  const allAvailableNames = [
    ...availableIngredients.map((i) => i.name),
    ...shoppingList.map((i) => i.name),
  ];
  const expiringNames = getExpiringNames(availableIngredients);
  const targetActive = timeLimitMinutes ?? kitchenProfile.maxActiveMinutes;
  const targetTotal = kitchenProfile.maxTotalMinutes;
  const currentGoal = userProfile?.goal;

  const results: MatchRecipeResult[] = [];

  for (const recipe of recipes) {
    const eligibility = evaluateEligibility(recipe, kitchenProfile, userProfile);
    if (!eligibility.eligible) continue;

    let score = 0;
    const scoreBreakdown: RecipeScoreBreakdown = {
      ingredients: 0,
      expiration: 0,
      kitchen: 0,
      time: 0,
      preferences: 0,
      goal: 0,
      feedback: 0,
      lowEnergy: 0,
    };
    const addScore = (category: keyof RecipeScoreBreakdown, points: number) => {
      score += points;
      scoreBreakdown[category] += points;
    };
    const reasons: string[] = [];
    const missing = computeMissing(recipe, allAvailableNames);

    // ========== 1. 食材匹配 ==========
    // 区分"库存已有"和"购物清单中待购"
    const matchedRequired = recipe.ingredients.filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    const matchedFromOwned = matchedRequired.filter((ing) =>
      ingredientMatched(ing, ownedNames)
    );
    const matchedFromShopping = matchedRequired.filter((ing) =>
      !ingredientMatched(ing, ownedNames) && ingredientMatched(ing, shoppingNames)
    );

    addScore("ingredients", matchedRequired.length * 8);
    if (matchedFromOwned.length > 0) {
      reasons.push(`命中库存食材：${matchedFromOwned.join("、")}`);
    }
    if (matchedFromShopping.length > 0) {
      reasons.push(`需从购物清单获取：${matchedFromShopping.join("、")}`);
      // 购物清单食材扣一点分，优先推荐库存已有的菜
      addScore("ingredients", -matchedFromShopping.length * 2);
    }

    // 缺少必需食材
    addScore("ingredients", -missing.length * 10);
    if (missing.length > 0) {
      reasons.push(`缺少食材：${missing.join("、")}`);
    }

    // 可选食材命中
    const matchedOptional = (recipe.optionalIngredients ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    addScore("ingredients", matchedOptional.length * 3);

    // primaryProtein 命中
    if (recipe.primaryProtein && ingredientMatched(recipe.primaryProtein, allAvailableNames)) {
      addScore("ingredients", 6);
      const fromOwned = ingredientMatched(recipe.primaryProtein, ownedNames);
      reasons.push(`主要蛋白质 ${recipe.primaryProtein} ${fromOwned ? "库存已有" : "需购买"}`);
    }

    // vegetables 命中
    const matchedVeg = (recipe.vegetables ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    addScore("ingredients", matchedVeg.length * 4);

    // staples 命中
    const matchedStaples = (recipe.staples ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    addScore("ingredients", matchedStaples.length * 3);

    // 快过期食材优先
    const expiringHit = recipe.ingredients.filter((ing) =>
      expiringNames.some((n) => {
        const ni = norm(ing);
        const nn = norm(n);
        return nn.includes(ni) || ni.includes(nn);
      })
    );
    if (expiringHit.length > 0) {
      addScore("expiration", expiringHit.length * 5);
      reasons.push(`${expiringHit.join("、")}快过期，优先处理`);
    }

    // ========== 2. 厨房约束 ==========
    const needsOven = (recipe.appliances ?? []).includes("oven");
    if (needsOven && kitchenProfile.hasOven) {
      addScore("kitchen", 6);
    }

    const needsStove = (recipe.appliances ?? []).includes("stove");
    if (needsStove && kitchenProfile.burners >= 1) {
      addScore("kitchen", 4);
    }

    // cookware 全部满足
    const hasAllCookware = recipe.cookware.every((cw) =>
      kitchenProfile.cookware.some((kcw) =>
        norm(kcw).includes(norm(cw)) || norm(cw).includes(norm(kcw))
      )
    );
    if (hasAllCookware && recipe.cookware.length > 0) {
      addScore("kitchen", 4);
    }

    // ========== 3. 时间约束 ==========
    if (recipe.activeMinutes <= targetActive) {
      addScore("time", 8);
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，符合目标（≤${targetActive} 分钟）`);
    } else if (recipe.activeMinutes <= targetActive + 5) {
      addScore("time", -6);
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，略超目标`);
    } else {
      addScore("time", -15);
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，超出目标较多`);
    }

    if (recipe.totalMinutes <= targetTotal) {
      addScore("time", 4);
    }

    // ========== 4. 用户偏好 ==========
    const cookingPrefs = kitchenProfile.cookingPreferences ?? [];
    const tastePrefs = kitchenProfile.tastePreferences ?? [];

    if (cookingPrefs.some((p) => p.includes("少洗碗")) && (recipe.preferenceTags ?? []).some((t) => t.includes("少洗碗"))) {
      addScore("preferences", 5);
      reasons.push("适合少洗碗偏好");
    }
    if (cookingPrefs.some((p) => p.includes("少油烟")) && (recipe.preferenceTags ?? []).some((t) => t.includes("少油烟"))) {
      addScore("preferences", 5);
      reasons.push("少油烟方案");
    }
    if (cookingPrefs.some((p) => p.includes("烤箱")) && (recipe.preferenceTags ?? []).some((t) => t.includes("烤箱"))) {
      addScore("preferences", 4);
      reasons.push("适合烤箱优先偏好");
    }

    // 口味偏好命中
    const matchedTaste = (recipe.tasteTags ?? []).filter((tag) =>
      tastePrefs.some((tp) => norm(tp).includes(norm(tag)) || norm(tag).includes(norm(tp)))
    );
    if (matchedTaste.length > 0) {
      addScore("preferences", 4);
      reasons.push(`符合口味偏好：${matchedTaste.join("、")}`);
    }

    // desiredStyle 命中
    if (desiredStyle) {
      const ds = norm(desiredStyle);
      const allTags = [
        ...(recipe.tasteTags ?? []),
        ...(recipe.preferenceTags ?? []),
        ...(recipe.suitableGoals ?? []),
      ].map(norm);
      if (allTags.some((t) => t.includes(ds) || ds.includes(t))) {
        addScore("preferences", 5);
      }
    }

    // ========== 5. 饮食目标 ==========
    if (currentGoal && (recipe.suitableGoals ?? []).includes(currentGoal)) {
      addScore("goal", 5);
      reasons.push(`适合当前目标：${currentGoal}`);
    }

    if (currentGoal === "muscle_gain" && recipe.proteinLevel === "high") {
      addScore("goal", 3);
      reasons.push("高蛋白，适合增肌");
    }
    if (currentGoal === "fat_loss" && (recipe.estimatedCalories ?? 0) > 0 && recipe.estimatedCalories! <= 550) {
      addScore("goal", 3);
      reasons.push(`热量约 ${recipe.estimatedCalories} kcal，适合减脂`);
    }

    // ========== 6. 用户反馈 ==========
    const relatedFeedback = feedback.filter(
      (fb) =>
        fb.recipeName &&
        (fb.recipeName.includes(recipe.name) || recipe.name.includes(fb.recipeName))
    );

    for (const fb of relatedFeedback) {
      if (fb.wouldCookAgain === true) {
        addScore("feedback", 8);
        reasons.push("你之前反馈下次还可以做");
      }
      if (fb.wouldCookAgain === false) {
        addScore("feedback", -12);
        reasons.push("你之前反馈不想再做这个");
      }
      if (fb.rating != null && fb.rating >= 4) {
        addScore("feedback", 4);
        reasons.push(`上次评分 ${fb.rating}/5，评价不错`);
      }
      if (fb.rating != null && fb.rating <= 2) {
        addScore("feedback", -8);
        reasons.push(`上次评分 ${fb.rating}/5，评价较低`);
      }
      if (fb.tooTiring) {
        addScore("feedback", -6);
        reasons.push("上次反馈太累/太麻烦");
      }
      if (fb.tooManyDishes) {
        addScore("feedback", -4);
        reasons.push("上次反馈洗碗太多");
      }
    }

    // ========== 7. 低能量模式 ==========
    if (energyLevel === "low") {
      if ((recipe.modes ?? []).includes("low_energy")) {
        addScore("lowEnergy", 8);
        reasons.push("适合低能量/不想做饭状态");
      }
      if (recipe.difficulty <= 2) {
        addScore("lowEnergy", 5);
      }
      if (recipe.dishCount <= 2) {
        addScore("lowEnergy", 5);
        reasons.push("碗碟少（" + recipe.dishCount + " 个），适合今天省力");
      }
      if (recipe.difficulty >= 4) {
        addScore("lowEnergy", -10);
        reasons.push("难度较高，不太适合今天省力状态");
      }
    }

    results.push({
      recipe,
      eligible: true,
      rejectedReasons: [],
      score,
      scoreBreakdown,
      reasons,
      missingIngredients: missing,
    });
  }

  // 按 score 降序排序
  results.sort((a, b) => b.score - a.score);

  return results;
}
