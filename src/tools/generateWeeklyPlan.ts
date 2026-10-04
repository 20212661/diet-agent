import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentToolResult, ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { computeIngredientReadiness, matchRecipes, type MatchRecipeResult } from "../recipes/recipeMatcher.js";
import { assessFoodSafety } from "../recipes/foodSafety.js";
import { isAvailableOn, type IngredientItem, type EnergyLevel, type WeeklyDayPlan } from "../types/diet.js";
import { formatNutritionCalories } from "../nutrition/nutritionEstimate.js";
import { recipeBlockReason } from "../recipes/executionConstraints.js";
import { mealFitsTimeLimits } from "../recipes/mealTiming.js";
import { isValidIsoDate } from "../utils/date.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  weekStartDate: Type.Optional(
    Type.String({ description: "指定那一周的周一日期 (YYYY-MM-DD)，默认本周" } as const)
  ),
  avoidDays: Type.Optional(
    Type.Array(Type.Number(), { description: "要跳过的星期几 (1-7, 1=周一)" } as const)
  ),
  preferredStyles: Type.Optional(
    Type.Array(Type.String(), { description: "偏好风格，如 清淡、烤箱" } as const)
  ),
  energyOverrides: Type.Optional(
    Type.Array(
      Type.Object({
        dayOfWeek: Type.Number({ description: "1-7" } as const),
        energyLevel: Type.Union(
          [Type.Literal("low"), Type.Literal("normal")],
          { description: "精力状态" } as const
        ),
      }),
      { description: "按天的精力水平覆盖" } as const
    )
  ),
});

type ParamsType = Static<typeof Params>;

/** 计算 YYYY-MM-DD 日期所在周的周一 */
function getMondayOfWeek(date?: string): string {
  const d = date ? new Date(date + "T00:00:00") : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const generateWeeklyPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "generate_weekly_plan",
  label: "生成一周菜单",
  description:
    "基于菜谱库、用户画像、库存、厨房条件、反馈和精力状态，生成完整 7 天晚餐计划并保存。用户说'帮我安排一周菜单 / 这周吃什么 / 生成一周计划'时调用。",
  parameters: Params,
  promptGuidelines: [
    "生成一周菜单时，必须确保 7 天内主菜不重复（除非菜谱库候选不足）。",
    "必须避开用户的 avoidFoods 和 allergies。",
    "优先使用库存已有食材，优先处理快过期食材。",
    "如果存在 medicalNotes，提醒用户这不是医疗饮食方案。",
  ],
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<{ userId: string; weekStartDate: string; days: WeeklyDayPlan[]; recipeCount: number; status: "matched" | "no_match" }>> {
    if (params.weekStartDate !== undefined && !isValidIsoDate(params.weekStartDate)) {
      throw new Error("weekStartDate 必须是有效的 YYYY-MM-DD 日期。");
    }
    if (params.avoidDays?.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new Error("avoidDays 只能包含 1 到 7 的整数。");
    }
    if (params.energyOverrides?.some((override) =>
      !Number.isInteger(override.dayOfWeek) || override.dayOfWeek < 1 || override.dayOfWeek > 7)) {
      throw new Error("energyOverrides 的星期只能是 1 到 7 的整数。");
    }
    const kitchen = store.getKitchenProfile(params.userId);
    const inventory = store.getIngredientInventory(params.userId);
    const dietProfile = store.getUserProfile(params.userId);
    const feedback = store.getCookingFeedback(params.userId);
    const recipes = store.getRecipeBook();

    // 计算本周 7 天日期
    const monday = getMondayOfWeek(params.weekStartDate);
    const mondayDate = new Date(monday + "T00:00:00");
    const avoidSet = new Set(params.avoidDays ?? []);

    const weekDays: Array<{ dayOfWeek: number; date: string }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(d.getDate() + i);
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      if (!avoidSet.has(dayOfWeek)) {
        weekDays.push({ dayOfWeek, date: formatDate(d) });
      }
    }

    // 追踪已选菜谱，保证多样性
    const usedRecipeIds = new Set<string>();
    const usedCount = new Map<string, number>();

    const days: WeeklyDayPlan[] = [];

    for (const { dayOfWeek, date } of weekDays) {
      const availableItems: IngredientItem[] = inventory.availableIngredients.filter((item) => isAvailableOn(item, date));
      // 确定当天精力水平
      const energyOverride = params.energyOverrides?.find((eo) => eo.dayOfWeek === dayOfWeek);
      const energyLevel: EnergyLevel = energyOverride?.energyLevel ?? "normal";

      const desiredStyle = (params.preferredStyles ?? []).join("、") || undefined;

      const matches = matchRecipes({
        recipes,
        date,
        availableIngredients: availableItems,
        shoppingList: inventory.shoppingList,
        kitchenProfile: kitchen,
        userProfile: dietProfile,
        feedback,
        timeLimitMinutes: kitchen.maxActiveMinutes,
        energyLevel,
        desiredStyle,
      }).filter((match) => !recipeBlockReason(match.recipe, kitchen, dietProfile));

      // 选主菜：优先未使用过的最高分
      let mainResult: MatchRecipeResult | undefined;
      const unused = matches.filter((m) => !usedRecipeIds.has(m.recipe.id));
      if (unused.length > 0) {
        mainResult = unused[0];
      } else {
        // fallback：选使用次数最少的
        const sorted = [...matches].sort((a, b) => {
          const ca = usedCount.get(a.recipe.id) ?? 0;
          const cb = usedCount.get(b.recipe.id) ?? 0;
          return ca - cb || b.score - a.score;
        });
        mainResult = sorted[0];
      }

      if (!mainResult) continue;

      usedRecipeIds.add(mainResult.recipe.id);
      usedCount.set(mainResult.recipe.id, (usedCount.get(mainResult.recipe.id) ?? 0) + 1);

      // 选配菜
      let sideResult: MatchRecipeResult | undefined;
      const sideCandidates = matches
        .filter((m) => {
          if (m.recipe.id === mainResult!.recipe.id) return false;
          if (m.missingIngredients.length > 0) return false;
          if (!mealFitsTimeLimits(mainResult!.recipe, m.recipe, kitchen)) return false;
          return true;
        })
        .sort((a, b) =>
          a.missingIngredients.length - b.missingIngredients.length ||
          a.recipe.dishCount - b.recipe.dishCount ||
          a.recipe.activeMinutes - b.recipe.activeMinutes ||
          b.score - a.score
        );

      sideResult = sideCandidates.find((m) => {
        const hasVegetable = (m.recipe.vegetables ?? []).length > 0;
        const notHeavyOven = !(m.recipe.modes?.includes("oven") && m.recipe.activeMinutes > 10);
        return hasVegetable && notHeavyOven;
      });

      if (!sideResult) {
        sideResult = sideCandidates.find((m) => m.recipe.dishCount <= 2 && m.recipe.activeMinutes <= 10);
      }

      const main = mainResult.recipe;
      const side = sideResult?.recipe;

      const ingredientReadiness = computeIngredientReadiness(
        [...main.ingredients, ...(side?.ingredients ?? [])],
        availableItems,
        inventory.shoppingList,
        date,
      );
      const missing = ingredientReadiness.filter((item) => item.status !== "owned").map((item) => item.ingredient);

      const recipeStaples = (main.staples ?? []).length > 0
        ? main.staples
        : (side?.staples ?? []).length > 0 ? side!.staples : [];
      const safeStaples = recipeStaples.filter((staple) =>
        assessFoodSafety([staple], dietProfile).status === "clear"
      );
      const staplesSuggestion = safeStaples.length > 0
        ? safeStaples.join("或")
        : recipeStaples.length > 0
          ? "主食待核实（请核对食材与产品标签）"
          : ["米饭", "面条", "馒头"].filter((staple) =>
            assessFoodSafety([staple], dietProfile).status === "clear"
          ).join("或") || "主食待核实（请核对食材与产品标签）";

      days.push({
        dayOfWeek,
        date,
        mainRecipe: {
          id: main.id,
          name: main.name,
          activeMinutes: main.activeMinutes,
          totalMinutes: main.totalMinutes,
          nutrition: main.nutrition,
        },
        sideRecipe: side
          ? { id: side.id, name: side.name, activeMinutes: side.activeMinutes, totalMinutes: side.totalMinutes }
          : undefined,
        staplesSuggestion,
        reasons: mainResult.reasons.slice(0, 3),
        missingIngredients: missing,
        ingredientReadiness,
        completed: false,
      });
    }

    if (days.length === 0) {
      return {
        content: [{ type: "text" as const, text: weekDays.length === 0
          ? "这一周的七天都被跳过，没有生成或覆盖周计划。"
          : "当前厨房设备、过敏忌口和时间上限下没有可执行菜谱；没有覆盖已有周计划。请调整可变条件后重试。" }],
        details: { userId: params.userId, weekStartDate: monday, days: [], recipeCount: 0, status: "no_match" },
      };
    }

    // 持久化
    const plan = store.upsertWeeklyPlan(params.userId, monday, days);

    // 生成可读文本
    const avoidFoods = [...(dietProfile?.avoidFoods ?? []), ...(dietProfile?.allergies ?? [])];
    const lines: string[] = [];
    lines.push(`## 一周菜单（${monday} 起）`);
    lines.push("");

    for (const day of days) {
      const label = DAY_LABELS[day.dayOfWeek] ?? `周${day.dayOfWeek}`;
      const sideText = day.sideRecipe ? ` + ${day.sideRecipe.name}` : "";
      const calories = formatNutritionCalories(day.mainRecipe.nutrition);
      const calText = calories ? `，${calories}（${day.mainRecipe.nutrition!.foodName} ${day.mainRecipe.nutrition!.amount}${day.mainRecipe.nutrition!.unit}，${day.mainRecipe.nutrition!.cookingMethod}；来源 ${day.mainRecipe.nutrition!.source} ${day.mainRecipe.nutrition!.sourceRecordId}，版本 ${day.mainRecipe.nutrition!.sourceVersion}）` : "";
      lines.push(`### ${label} (${day.date})`);
      lines.push(`- 主菜：${day.mainRecipe.name}（主动 ${day.mainRecipe.activeMinutes} 分钟，总计 ${day.mainRecipe.totalMinutes} 分钟${calText}）`);
      if (day.sideRecipe) {
        lines.push(`- 配菜：${day.sideRecipe.name}（主动 ${day.sideRecipe.activeMinutes} 分钟）`);
      }
      lines.push(`- 主食：${day.staplesSuggestion}`);
      if (day.missingIngredients.length > 0) {
        lines.push(`- 缺少食材：${day.missingIngredients.join("、")}`);
      }
      const alreadyOnList = day.ingredientReadiness?.filter((item) => item.status === "already_on_list").map((item) => item.ingredient) ?? [];
      const toAdd = day.ingredientReadiness?.filter((item) => item.status === "to_add_to_list").map((item) => item.ingredient) ?? [];
      if (alreadyOnList.length > 0) lines.push(`- 已列待购：${alreadyOnList.join("、")}`);
      if (toAdd.length > 0) lines.push(`- 待加入采购清单：${toAdd.join("、")}`);
      for (const reason of day.reasons) {
        lines.push(`  - ${reason}`);
      }
      lines.push("");
    }

    // 汇总缺少食材
    const allMissing = [...new Set(days.flatMap((d) => d.missingIngredients))];
    if (allMissing.length > 0) {
      lines.push("### 需要购买的食材汇总");
      lines.push(allMissing.join("、"));
      lines.push("");
    }

    if (avoidFoods.length > 0) {
      lines.push(`已避开：${avoidFoods.join("、")}`);
      lines.push("⚠️ 仅按已知食材和菜谱标签筛选，不代表已确认安全；请核对包装标签与交叉接触风险。");
    }

    if (dietProfile?.medicalNotes && dietProfile.medicalNotes.length > 0) {
      lines.push("⚠️ 你有健康备注记录。本计划仅为日常参考，不是医疗饮食方案。如有疾病、孕期、用药等情况，请咨询医生或专业营养师。");
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: {
        userId: params.userId,
        weekStartDate: monday,
        days: plan.days,
        recipeCount: usedRecipeIds.size,
        status: "matched",
      },
    };
  },
});
