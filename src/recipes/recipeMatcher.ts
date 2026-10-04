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
  IngredientReadiness,
} from "../types/diet.js";
import { isAvailable, isAvailableOn } from "../types/diet.js";
import { getVerifiedCalories } from "../nutrition/nutritionEstimate.js";
import { normalizeIngredientId } from "./ingredientTaxonomy.js";
import { assessFoodSafety } from "./foodSafety.js";

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
  date?: string;
}

export interface MatchRecipeResult {
  recipe: RecipeRecord;
  score: number;
  reasons: string[];
  missingIngredients: string[];
  ingredientReadiness: IngredientReadiness[];
}

export interface MatchRecipeOutcome {
  status: "matched" | "no_match";
  matches: MatchRecipeResult[];
  blockingReasons: string[];
  adjustableConditions: string[];
}

// ---- 工具函数 ----

/** 规范化食材名称用于模糊匹配 */
function norm(name: string): string {
  return name.toLowerCase().trim();
}

/** 判断 available 中是否有能匹配 ingredient 的项 */
function ingredientMatched(ingredient: string, available: string[]): boolean {
  const ing = norm(ingredient);
  const ingredientId = normalizeIngredientId(ingredient);
  return available.some((a) => {
    const na = norm(a);
    return normalizeIngredientId(a) === ingredientId || na.includes(ing) || ing.includes(na);
  });
}

/** 获取快过期的食材名称列表 */
function getExpiringNames(items: IngredientItem[]): string[] {
  return items.filter((item) => item.expiresSoon).map((item) => item.name);
}

/** 计算缺少的必需食材 */
export function computeIngredientReadiness(
  requiredIngredients: string[],
  ownedItems: IngredientItem[],
  shoppingItems: IngredientItem[],
  date?: string,
): IngredientReadiness[] {
  const ownedNames = ownedItems.filter((item) => date ? isAvailableOn(item, date) : isAvailable(item)).map((item) => item.name);
  const shoppingNames = shoppingItems.map((item) => item.name);
  return [...new Set(requiredIngredients)].map((ingredient) => {
    if (ingredientMatched(ingredient, ownedNames)) {
      return { ingredient, status: "owned", quantityVerified: false };
    }
    if (ingredientMatched(ingredient, shoppingNames)) {
      return { ingredient, status: "already_on_list" };
    }
    return { ingredient, status: "to_add_to_list" };
  });
}

// ---- 主评分函数 ----

export function matchRecipesDetailed(input: MatchRecipeInput): MatchRecipeOutcome {
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
  const activeIngredients = availableIngredients.filter((item) => input.date ? isAvailableOn(item, input.date) : isAvailable(item));
  const ownedNames = activeIngredients.map((i) => i.name);
  // 购物清单中的食材名称
  const shoppingNames = shoppingList.map((i) => i.name);
  // 所有的可用食材名称（库存 + 购物清单都可用于匹配）
  const allAvailableNames = [
    ...activeIngredients.map((i) => i.name),
    ...shoppingList.map((i) => i.name),
  ];
  const avoidFoods = userProfile?.avoidFoods ?? [];
  const expiringNames = getExpiringNames(activeIngredients);
  const targetActive = timeLimitMinutes ?? kitchenProfile.maxActiveMinutes;
  const targetTotal = kitchenProfile.maxTotalMinutes;
  const currentGoal = userProfile?.goal;

  const results: MatchRecipeResult[] = [];
  const blockers = new Set<string>();

  for (const recipe of recipes) {
    let score = 0;
    const reasons: string[] = [];
    const ingredientReadiness = computeIngredientReadiness(recipe.ingredients, activeIngredients, shoppingList, input.date);
    // Compatibility contract: missing means absent from owned inventory, including items already on the shopping list.
    const missing = ingredientReadiness.filter((item) => item.status !== "owned").map((item) => item.ingredient);

    // ========== 1. 忌口/过敏检查 ==========
    const allRecipeFoods = [
      ...recipe.ingredients,
      ...(recipe.optionalIngredients ?? []),
      ...(recipe.vegetables ?? []),
      ...(recipe.staples ?? []),
      ...(recipe.primaryProtein ? [recipe.primaryProtein] : []),
    ];
    const safety = assessFoodSafety(allRecipeFoods, userProfile, recipe.allergenTags ?? []);
    if (safety.status !== "clear") {
      // 过敏和忌口是硬约束，不能靠低分保证安全：当候选较少时，-999
      // 仍可能被排到第一名。直接排除，调用方才能安全地使用结果首项。
      if (safety.status === "conflict") {
        blockers.add(`过敏或忌口冲突：${safety.conflicts.join("、")}`);
      } else {
        blockers.add(`部分食材无法确认是否符合过敏/忌口要求：${safety.unknownIngredients.join("、")}`);
      }
      continue;
    }

    // ========== 2. 食材匹配 ==========
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

    score += matchedRequired.length * 8;
    if (matchedFromOwned.length > 0) {
      reasons.push(`命中库存食材：${matchedFromOwned.join("、")}`);
    }
    if (matchedFromShopping.length > 0) {
      reasons.push(`需从购物清单获取：${matchedFromShopping.join("、")}`);
      // 购物清单食材扣一点分，优先推荐库存已有的菜
      score -= matchedFromShopping.length * 2;
    }

    // 缺少必需食材
    score -= missing.length * 10;
    if (missing.length > 0) {
      reasons.push(`缺少食材：${missing.join("、")}`);
    }

    // 可选食材命中
    const matchedOptional = (recipe.optionalIngredients ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    score += matchedOptional.length * 3;

    // primaryProtein 命中
    if (recipe.primaryProtein && ingredientMatched(recipe.primaryProtein, allAvailableNames)) {
      score += 6;
      const fromOwned = ingredientMatched(recipe.primaryProtein, ownedNames);
      reasons.push(`主要蛋白质 ${recipe.primaryProtein} ${fromOwned ? "库存已有" : "需购买"}`);
    }

    // vegetables 命中
    const matchedVeg = (recipe.vegetables ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    score += matchedVeg.length * 4;

    // staples 命中
    const matchedStaples = (recipe.staples ?? []).filter((ing) =>
      ingredientMatched(ing, allAvailableNames)
    );
    score += matchedStaples.length * 3;

    // 快过期食材优先
    const expiringHit = recipe.ingredients.filter((ing) =>
      expiringNames.some((n) => {
        const ni = norm(ing);
        const nn = norm(n);
        return nn.includes(ni) || ni.includes(nn);
      })
    );
    if (expiringHit.length > 0) {
      score += expiringHit.length * 5;
      reasons.push(`${expiringHit.join("、")}快过期，优先处理`);
    }

    // ========== 3. 厨房约束 ==========
    const needsOven = (recipe.appliances ?? []).includes("oven");
    if (needsOven && !kitchenProfile.hasOven) {
      blockers.add("缺少烤箱");
      continue;
    }
    if (needsOven && kitchenProfile.hasOven) {
      score += 6;
    }

    const needsStove = (recipe.appliances ?? []).includes("stove");
    if (needsStove && kitchenProfile.burners < 1) {
      blockers.add("没有可用灶台");
      continue;
    }
    if (needsStove && kitchenProfile.burners >= 1) {
      score += 4;
    }

    const needsMicrowave = (recipe.appliances ?? []).includes("microwave");
    if (needsMicrowave && !kitchenProfile.hasMicrowave) {
      blockers.add("缺少微波炉");
      continue;
    }
    if (needsMicrowave && kitchenProfile.hasMicrowave) {
      score += 3;
    }

    const needsRiceCooker = (recipe.appliances ?? []).includes("rice_cooker");
    if (needsRiceCooker && !kitchenProfile.hasRiceCooker) {
      blockers.add("缺少电饭煲");
      continue;
    }
    if (needsRiceCooker && kitchenProfile.hasRiceCooker) {
      score += 3;
    }

    // cookware 全部满足
    const hasAllCookware = recipe.cookware.every((cw) =>
      kitchenProfile.cookware.some((kcw) =>
        norm(kcw).includes(norm(cw)) || norm(cw).includes(norm(kcw))
      )
    );
    if (!hasAllCookware && recipe.cookware.length > 0) {
      blockers.add(`缺少必需厨具：${recipe.cookware.filter((cw) => !kitchenProfile.cookware.some((kcw) => norm(kcw).includes(norm(cw)) || norm(cw).includes(norm(kcw)))).join("、")}`);
      continue;
    }
    if (hasAllCookware && recipe.cookware.length > 0) {
      score += 4;
    }

    // ========== 4. 时间约束 ==========
    if (recipe.activeMinutes <= targetActive) {
      score += 8;
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，符合目标（≤${targetActive} 分钟）`);
    } else if (recipe.activeMinutes <= targetActive + 5) {
      score -= 6;
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，略超目标`);
    } else {
      score -= 15;
      reasons.push(`主动操作 ${recipe.activeMinutes} 分钟，超出目标较多`);
    }

    if (recipe.totalMinutes <= targetTotal) {
      score += 4;
    }

    // ========== 5. 用户偏好 ==========
    const cookingPrefs = kitchenProfile.cookingPreferences ?? [];
    const tastePrefs = kitchenProfile.tastePreferences ?? [];

    if (cookingPrefs.some((p) => p.includes("少洗碗")) && (recipe.preferenceTags ?? []).some((t) => t.includes("少洗碗"))) {
      score += 5;
      reasons.push("适合少洗碗偏好");
    }
    if (cookingPrefs.some((p) => p.includes("少油烟")) && (recipe.preferenceTags ?? []).some((t) => t.includes("少油烟"))) {
      score += 5;
      reasons.push("少油烟方案");
    }
    if (cookingPrefs.some((p) => p.includes("烤箱")) && (recipe.preferenceTags ?? []).some((t) => t.includes("烤箱"))) {
      score += 4;
      reasons.push("适合烤箱优先偏好");
    }

    // 口味偏好命中
    const matchedTaste = (recipe.tasteTags ?? []).filter((tag) =>
      tastePrefs.some((tp) => norm(tp).includes(norm(tag)) || norm(tag).includes(norm(tp)))
    );
    if (matchedTaste.length > 0) {
      score += 4;
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
        score += 5;
      }
    }

    // ========== 6. 饮食目标 ==========
    if (currentGoal && (recipe.suitableGoals ?? []).includes(currentGoal)) {
      score += 5;
      reasons.push(`适合当前目标：${currentGoal}`);
    }

    if (currentGoal === "muscle_gain" && recipe.proteinLevel === "high") {
      score += 3;
      reasons.push("高蛋白，适合增肌");
    }
    const verifiedCalories = getVerifiedCalories(recipe.nutrition);
    if (currentGoal === "fat_loss" && verifiedCalories !== undefined && verifiedCalories > 0 && verifiedCalories <= 550) {
      score += 3;
      reasons.push(`热量 ${Math.round(verifiedCalories)} kcal（可追溯数据），适合减脂参考`);
    }

    // ========== 7. 用户反馈 ==========
    const relatedFeedback = feedback.filter(
      (fb) =>
        fb.recipeName &&
        (fb.recipeName.includes(recipe.name) || recipe.name.includes(fb.recipeName))
    );

    for (const fb of relatedFeedback) {
      if (fb.wouldCookAgain === true) {
        score += 8;
        reasons.push("你之前反馈下次还可以做");
      }
      if (fb.wouldCookAgain === false) {
        score -= 12;
        reasons.push("你之前反馈不想再做这个");
      }
      if (fb.rating != null && fb.rating >= 4) {
        score += 4;
        reasons.push(`上次评分 ${fb.rating}/5，评价不错`);
      }
      if (fb.rating != null && fb.rating <= 2) {
        score -= 8;
        reasons.push(`上次评分 ${fb.rating}/5，评价较低`);
      }
      if (fb.tooTiring) {
        score -= 6;
        reasons.push("上次反馈太累/太麻烦");
      }
      if (fb.tooManyDishes) {
        score -= 4;
        reasons.push("上次反馈洗碗太多");
      }
    }

    // ========== 8. 低能量模式 ==========
    if (energyLevel === "low") {
      if ((recipe.modes ?? []).includes("low_energy")) {
        score += 8;
        reasons.push("适合低能量/不想做饭状态");
      }
      if (recipe.difficulty <= 2) {
        score += 5;
      }
      if (recipe.dishCount <= 2) {
        score += 5;
        reasons.push("碗碟少（" + recipe.dishCount + " 个），适合今天省力");
      }
      if (recipe.difficulty >= 4) {
        score -= 10;
        reasons.push("难度较高，不太适合今天省力状态");
      }
    }

    results.push({ recipe, score, reasons, missingIngredients: missing, ingredientReadiness });
  }

  // 按 score 降序排序
  results.sort((a, b) => b.score - a.score);

  return {
    status: results.length > 0 ? "matched" : "no_match",
    matches: results,
    blockingReasons: [...blockers],
    adjustableConditions: results.length === 0
      ? ["增加可用设备或厨具", "购买符合过敏与忌口要求的食材", "放宽主动操作时间上限"]
      : [],
  };
}

/** Compatibility helper for callers that only need ranked matches. */
export function matchRecipes(input: MatchRecipeInput): MatchRecipeResult[] {
  return matchRecipesDetailed(input).matches;
}
