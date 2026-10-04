import * as store from "../store/index.js";
import { todayDate } from "../store/shared.js";
import { computeIngredientReadiness, matchRecipes, type MatchRecipeResult } from "../recipes/recipeMatcher.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";
import { normalizeIngredientId } from "../recipes/ingredientTaxonomy.js";
import { executionBlockReason, recipeBlockReason, type ExecutableMeal } from "../recipes/executionConstraints.js";
import type { KitchenProfile } from "../types/diet.js";
import { isAvailableOn, type EnergyLevel, type IngredientItem, type MealPlanDay, type MealType, type PlannedMeal, type UserGoal, type UserProfile } from "../types/diet.js";


export interface MealPlanRequest {
  userId: string; days?: number; startDate?: string; target?: string; timeLimitMinutes?: number;
  energyLevel?: EnergyLevel; preferredStyles?: string[]; temporaryAvoidFoods?: string[];
}

type PlannedMealType = Exclude<MealType, "unknown">;
interface MealOption extends ExecutableMeal { text: string; ingredients: string[] }
const meal = (text: string, activeMinutes: number, preparation: Pick<ExecutableMeal, "totalMinutes" | "appliances" | "cookware">, ...ingredients: string[]): MealOption => ({ text, activeMinutes, ...preparation, ingredients });

const PLAN_TEMPLATES: Record<string, Record<PlannedMealType, MealOption[]>> = {
  fat_loss: {
    breakfast: [meal("全麦面包 2 片 + 水煮蛋 1 个 + 牛奶 250ml", 8, { totalMinutes: 15, appliances: ["stove"], cookware: ["汤锅"] }, "全麦面包", "鸡蛋", "牛奶"), meal("燕麦粥 1 碗 + 蓝莓 + 鸡蛋 1 个", 10, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "燕麦粥", "蓝莓", "鸡蛋")],
    lunch: [meal("鸡胸肉 150g + 糙米饭 1 碗 + 西兰花", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鸡胸肉", "糙米饭", "西兰花"), meal("瘦肉 120g + 紫薯 + 生菜沙拉", 15, { totalMinutes: 25, appliances: ["stove"], cookware: ["汤锅"] }, "瘦肉", "紫薯", "生菜")],
    dinner: [meal("清蒸鱼 150g + 西兰花 + 少量杂粮饭", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鱼", "西兰花", "杂粮饭"), meal("豆腐西兰花汤 + 玉米半根", 15, { totalMinutes: 25, appliances: ["stove"], cookware: ["汤锅"] }, "豆腐", "西兰花", "玉米")],
    snack: [meal("苹果 1 个", 2, { totalMinutes: 2, appliances: [], cookware: [] }, "苹果"), meal("原味酸奶 1 杯", 2, { totalMinutes: 2, appliances: [], cookware: [] }, "酸奶")],
  },
  muscle_gain: {
    breakfast: [meal("全麦面包 3 片 + 鸡蛋 2 个 + 牛奶 300ml + 香蕉", 10, { totalMinutes: 15, appliances: ["stove"], cookware: ["汤锅"] }, "全麦面包", "鸡蛋", "牛奶", "香蕉"), meal("燕麦粥 + 蛋白粉 1 勺 + 坚果", 10, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "燕麦粥", "蛋白粉", "坚果")],
    lunch: [meal("鸡胸肉 200g + 米饭 1.5 碗 + 西兰花 + 鸡蛋 1 个", 18, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鸡胸肉", "米饭", "西兰花", "鸡蛋"), meal("三文鱼 150g + 糙米饭 + 牛油果", 18, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "三文鱼", "糙米饭", "牛油果")],
    dinner: [meal("虾 200g + 米饭 1 碗 + 西兰花", 18, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "虾", "米饭", "西兰花"), meal("鸡胸肉 200g + 意面 + 生菜", 18, { totalMinutes: 25, appliances: ["stove"], cookware: ["汤锅"] }, "鸡胸肉", "意面", "生菜")],
    snack: [meal("香蕉 + 原味酸奶", 3, { totalMinutes: 3, appliances: [], cookware: [] }, "香蕉", "酸奶"), meal("牛奶 + 水煮蛋", 5, { totalMinutes: 15, appliances: ["stove"], cookware: ["汤锅"] }, "牛奶", "鸡蛋")],
  },
  default: {
    breakfast: [meal("全麦面包 + 鸡蛋 + 牛奶", 8, { totalMinutes: 15, appliances: ["stove"], cookware: ["汤锅"] }, "全麦面包", "鸡蛋", "牛奶"), meal("杂粮粥 + 蔬菜包 + 豆浆", 10, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "杂粮粥", "蔬菜包", "豆浆")],
    lunch: [meal("鸡肉 + 米饭 + 西兰花", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鸡肉", "米饭", "西兰花"), meal("鱼 + 米饭 + 西兰花", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鱼", "米饭", "西兰花"), meal("猪肉 + 米饭 + 西兰花", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "猪肉", "米饭", "西兰花")],
    dinner: [meal("清淡鸡肉 + 西兰花 + 米饭", 15, { totalMinutes: 30, appliances: ["stove"], cookware: ["汤锅"] }, "鸡肉", "西兰花", "米饭"), meal("汤面 + 西兰花 + 豆腐", 15, { totalMinutes: 25, appliances: ["stove"], cookware: ["汤锅"] }, "汤面", "西兰花", "豆腐")],
    snack: [meal("苹果 1 份", 2, { totalMinutes: 2, appliances: [], cookware: [] }, "苹果"), meal("原味酸奶 1 杯", 2, { totalMinutes: 2, appliances: [], cookware: [] }, "酸奶")],
  },
};

const MEAL_TYPES: readonly PlannedMealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<PlannedMealType, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const GOAL_LABELS: Record<UserGoal, string> = {
  fat_loss: "减脂",
  muscle_gain: "增肌",
  maintain: "维持体重",
  healthier_eating: "健康饮食",
  custom: "自定义目标",
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && formatDate(date) === value;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inferGoal(target?: string): UserGoal | undefined {
  if (!target) return undefined;
  if (/(减脂|减重|控制体重|低卡)/.test(target)) return "fat_loss";
  if (/(增肌|增重|高蛋白)/.test(target)) return "muscle_gain";
  if (/(均衡|健康饮食)/.test(target)) return "healthier_eating";
  return undefined;
}

function inferEnergy(target?: string): EnergyLevel | undefined {
  return target && /(低能量|没精力|很累|省力|不想动)/.test(target) ? "low" : undefined;
}

function inferTimeLimit(target?: string): number | undefined {
  if (!target) return undefined;
  const match = target.match(/(?:不超过|控制在|最多|约|大约)?\s*(\d{1,3})\s*分钟/);
  return match ? Math.max(1, Math.min(240, Number(match[1]))) : undefined;
}

function ingredientAvailable(name: string, available: readonly string[]): boolean {
  const id = normalizeIngredientId(name);
  return available.some((candidate) => {
    const candidateId = normalizeIngredientId(candidate);
    return candidateId === id || candidate.toLocaleLowerCase().includes(name.toLocaleLowerCase()) || name.toLocaleLowerCase().includes(candidate.toLocaleLowerCase());
  });
}

function unavailableMeal(mealType: PlannedMealType, reason: string): PlannedMeal {
  return { mealType, source: "unavailable", name: `${MEAL_LABELS[mealType]}暂无符合条件的方案`, ingredients: [], missingIngredients: [], reasons: [reason] };
}

function recipeCandidate(
  mealType: PlannedMealType,
  matches: MatchRecipeResult[],
  timeLimitMinutes: number | undefined,
  usage: Map<string, number>,
  usedToday: Set<string>,
): MatchRecipeResult | undefined {
  const eligible = matches.filter(({ recipe }) =>
    recipe.mealTypes.includes(mealType) &&
    (timeLimitMinutes === undefined || recipe.activeMinutes <= timeLimitMinutes),
  );
  eligible.sort((left, right) => {
    const leftUses = usage.get(left.recipe.id) ?? 0;
    const rightUses = usage.get(right.recipe.id) ?? 0;
    const leftScore = left.score - leftUses * 18 - (usedToday.has(left.recipe.id) ? 100 : 0);
    const rightScore = right.score - rightUses * 18 - (usedToday.has(right.recipe.id) ? 100 : 0);
    return rightScore - leftScore || left.recipe.id.localeCompare(right.recipe.id);
  });
  return eligible[0];
}

function chooseTemplate(
  mealType: PlannedMealType,
  options: MealOption[],
  profile: UserProfile,
  availableNames: string[],
  target: string,
  preferredStyles: string[],
  timeLimitMinutes: number | undefined,
  usage: Map<string, number>,
  kitchen: KitchenProfile,
): PlannedMeal | undefined {
  const candidates = options.flatMap((option) => {
    if (executionBlockReason(option, kitchen, profile, timeLimitMinutes)) return [];
    const safety = assessFoodSafety(option.ingredients, profile);
    if (safety.status !== "clear") return [];
    const matched = option.ingredients.filter((ingredient) => ingredientAvailable(ingredient, availableNames));
    const styleTerms = [...preferredStyles, target].filter(Boolean);
    const styleScore = styleTerms.reduce((score, term) => score + (option.text.includes(term) ? 4 : 0), 0);
    const key = `${mealType}:${option.text}`;
    const score = matched.length * 5 + styleScore - (usage.get(key) ?? 0) * 12;
    const missing = option.ingredients.filter((ingredient) => !ingredientAvailable(ingredient, availableNames));
    return [{ option, key, score, matched, missing }];
  });
  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const selected = candidates[0];
  if (!selected) return undefined;
  usage.set(selected.key, (usage.get(selected.key) ?? 0) + 1);
  const reasons = ["安全筛选通过的基础搭配模板"];
  if (selected.matched.length) reasons.push(`优先使用现有食材：${selected.matched.join("、")}`);
  if (selected.missing.length) reasons.push(`仍需准备：${selected.missing.join("、")}`);
  return {
    mealType,
    source: "template",
    name: selected.option.text,
    ingredients: selected.option.ingredients,
    activeMinutes: selected.option.activeMinutes,
    totalMinutes: selected.option.totalMinutes,
    appliances: [...selected.option.appliances],
    cookware: [...selected.option.cookware],
    missingIngredients: selected.missing,
    reasons,
  };
}

export function buildAndSaveMealPlan(params: MealPlanRequest) {
  const daysCount = Math.max(1, Math.min(7, Math.floor(params.days ?? 1)));
  const startDate = params.startDate ?? todayDate();
  if (!validDate(startDate)) throw new Error("startDate 必须是有效的 YYYY-MM-DD 日期。");

  const savedProfile = store.getUserProfile(params.userId);
  const kitchen = store.getKitchenProfile(params.userId);
  const inventory = store.getIngredientInventory(params.userId);
  const feedback = store.getCookingFeedback(params.userId);
  const recipes = store.getRecipeBook();
  const goal = inferGoal(params.target) ?? savedProfile?.goal;
  const temporaryAvoidFoods = (params.temporaryAvoidFoods ?? []).map((food) => food.trim()).filter(Boolean);
  const userProfile = {
    ...(savedProfile ?? { userId: params.userId, createdAt: "", updatedAt: "" }),
    ...(goal ? { goal } : {}),
    avoidFoods: [...new Set([...(savedProfile?.avoidFoods ?? []), ...temporaryAvoidFoods])],
  } as UserProfile;
  const profileForTemplates = userProfile;
  const timeLimitMinutes = Math.max(1, Math.min(240, kitchen.maxActiveMinutes, Math.floor(params.timeLimitMinutes ?? inferTimeLimit(params.target) ?? kitchen.maxActiveMinutes)));
  const energyLevel: EnergyLevel = params.energyLevel ?? inferEnergy(params.target) ?? "normal";
  const preferredStyles = [...new Set([...(params.preferredStyles ?? []), ...kitchen.tastePreferences, ...kitchen.cookingPreferences])];
  const templateGoal = goal === "fat_loss" || goal === "muscle_gain" ? goal : "default";
  const templates = PLAN_TEMPLATES[templateGoal];
  const usage = new Map<string, number>();
  const days: MealPlanDay[] = [];

  for (let offset = 0; offset < daysCount; offset++) {
    const date = new Date(`${startDate}T00:00:00`);
    date.setDate(date.getDate() + offset);
    const dateText = formatDate(date);
    const activeItems: IngredientItem[] = inventory.availableIngredients.filter((item) => isAvailableOn(item, dateText));
    const allAvailableNames = activeItems.map((item) => item.name);
    const usedToday = new Set<string>();
    const matches = matchRecipes({
      recipes,
      date: dateText,
      availableIngredients: activeItems,
      shoppingList: inventory.shoppingList,
      kitchenProfile: kitchen,
      userProfile,
      feedback,
      timeLimitMinutes,
      energyLevel,
      desiredStyle: [...preferredStyles, ...(params.target ? [params.target] : [])].join(" ") || undefined,
    }).filter(({ recipe }) => !recipeBlockReason(recipe, kitchen, userProfile, timeLimitMinutes));

    const plannedMeals: PlannedMeal[] = [];
    for (const mealType of MEAL_TYPES) {
      const match = recipeCandidate(mealType, matches, timeLimitMinutes, usage, usedToday);
      if (match) {
        const recipe = match.recipe;
        usage.set(recipe.id, (usage.get(recipe.id) ?? 0) + 1);
        usedToday.add(recipe.id);
        plannedMeals.push({
          mealType,
          source: "recipe",
          name: recipe.name,
          recipeId: recipe.id,
          ingredients: [...new Set([...recipe.ingredients, ...(recipe.staples ?? [])])],
          activeMinutes: recipe.activeMinutes,
          totalMinutes: recipe.totalMinutes,
          missingIngredients: computeIngredientReadiness([...recipe.ingredients, ...(recipe.staples ?? [])], activeItems, inventory.shoppingList, dateText)
            .filter((item) => item.status !== "owned").map((item) => item.ingredient),
          appliances: recipe.appliances,
          cookware: recipe.cookware,
          reasons: match.reasons.slice(0, 3),
          nutrition: recipe.nutrition,
        });
        continue;
      }

      const fallback = chooseTemplate(
        mealType,
        templates[mealType],
        profileForTemplates,
        allAvailableNames,
        params.target ?? "",
        preferredStyles,
        timeLimitMinutes,
        usage,
        kitchen,
      );
      plannedMeals.push(fallback ?? unavailableMeal(
        mealType,
        `没有同时满足过敏忌口、厨房设备、${timeLimitMinutes} 分钟主动操作及 ${kitchen.maxTotalMinutes} 分钟总耗时上限的候选；未生成替代食材建议。`,
      ));
    }
    days.push({ date: dateText, meals: plannedMeals });
  }

  const plan = store.upsertMealPlan(params.userId, startDate, days, {
    target: params.target,
    goal,
    constraints: { temporaryAvoidFoods, timeLimitMinutes, energyLevel, preferredStyles: params.preferredStyles ?? [] },
  });
  const lines = [`## 饮食计划（${daysCount} 天，${startDate} 起）`];
  if (goal) lines.push(`目标：${goal === "custom" && savedProfile?.customGoal ? savedProfile.customGoal : GOAL_LABELS[goal]}`);
  if (params.target) lines.push(`补充要求：${params.target}`);
  lines.push(`主动操作时间上限：每餐 ${timeLimitMinutes} 分钟；精力状态：${energyLevel === "low" ? "低能量" : "正常"}`);
  lines.push("计划优先使用菜谱库、库存和购物清单；模板搭配没有可追溯的营养数值，不作热量承诺。\n");

  for (const day of days) {
    lines.push(`### ${day.date}`);
    for (const planned of day.meals) {
      const label = MEAL_LABELS[planned.mealType];
      if (planned.source === "unavailable") {
        lines.push(`- ${label}：${planned.name}。${planned.reasons[0]}`);
        continue;
      }
      const duration = planned.activeMinutes === undefined ? "" : `（主动 ${planned.activeMinutes} 分钟${planned.totalMinutes ? `，总计 ${planned.totalMinutes} 分钟` : ""}）`;
      lines.push(`- ${label}：${planned.name}${duration}${planned.source === "template" ? "（基础模板）" : ""}`);
      if (planned.missingIngredients.length) lines.push(`  - 需准备：${planned.missingIngredients.join("、")}`);
    }
    lines.push("");
  }

  const allMissing = [...new Set(days.flatMap((day) => day.meals.flatMap((planned) => planned.missingIngredients)))];
  if (allMissing.length) lines.push(`### 需要准备的食材\n${allMissing.join("、")}\n`);

  if (temporaryAvoidFoods.length) lines.push(`本次临时避开：${temporaryAvoidFoods.join("、")}（未写入长期画像）`);
  const savedAllergies = savedProfile?.allergies ?? [];
  const restrictions = [...new Set([...(savedProfile?.avoidFoods ?? []), ...savedAllergies, ...temporaryAvoidFoods])];
  if (restrictions.length) {
    lines.push(`已按已知食材信息筛选: ${restrictions.join("、")}`);
    lines.push("过敏与忌口仅按已知食材及菜谱信息筛选；仍请核对产品标签和交叉接触风险。" );
  }
  if (savedProfile?.medicalNotes?.length) {
    lines.push("你有健康备注记录。本计划仅供日常参考，不是医疗饮食方案；如有疾病、孕期或用药情况，请咨询医生或专业营养师。");
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { userId: params.userId, startDate, days: plan.days, goal, timeLimitMinutes, energyLevel },
  };
}
