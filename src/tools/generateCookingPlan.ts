import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { matchRecipes, type MatchRecipeResult } from "../recipes/recipeMatcher.js";
import * as recipeCatalog from "../recipes/recipeCatalog.js";
import type { IngredientItem, RecipeRecord } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  availableIngredients: Type.Optional(Type.Array(Type.String(), { description: "本次可用食材" } as const)),
  shoppingList: Type.Optional(Type.Array(Type.String(), { description: "本次愿意购买的食材" } as const)),
  timeLimitMinutes: Type.Optional(Type.Number({ description: "希望控制的主动操作时间，单位分钟" } as const)),
  energyLevel: Type.Optional(
    Type.Union([Type.Literal("low"), Type.Literal("normal")], { description: "精力状态" } as const)
  ),
  desiredStyle: Type.Optional(Type.String({ description: "想吃的风格或限制，如清淡、减脂、少油烟" } as const)),
});

type ParamsType = Static<typeof Params>;

function names(items: { name: string }[]) {
  return items.map((item) => item.name);
}

function toItems(items: string[] | undefined): IngredientItem[] {
  return (items ?? []).map((name) => ({ name }));
}

export const generateCookingPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "generate_cooking_plan",
  label: "生成做饭计划",
  description:
    "根据现有食材、购物清单、厨房条件、可用时间和精力状态，生成晚饭方案、厨具安排、并行时间线和详细步骤。用户说'帮我安排晚饭'、'这些食材怎么做'、'今天很累怎么做饭'时调用。",
  parameters: Params,
  promptGuidelines: [
    "输出必须包含晚饭方案、使用食材、厨具安排、时间线、详细步骤、低能量版本、推荐理由。",
    "优先减少主动操作时间，优先烤箱主菜加灶台快手蔬菜。",
    "如果信息不足，可以基于默认厨房画像给出方案，并说明假设。",
  ],
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const kitchen = store.getKitchenProfile(params.userId);
    const inventory = store.getIngredientInventory(params.userId);
    const dietProfile = store.getUserProfile(params.userId);
    const feedback = store.getCookingFeedback(params.userId);
    const recipes = recipeCatalog.listForUser(params.userId);

    // 只取 status 为 available 或无 status 的食材
    const availableItems: IngredientItem[] = [
      ...inventory.availableIngredients.filter((item) => !item.status || item.status === "available"),
      ...toItems(params.availableIngredients),
    ];
    const shoppingItems: IngredientItem[] = [
      ...inventory.shoppingList,
      ...toItems(params.shoppingList),
    ];

    // 按过期紧急度排序：快过期排前面，再按 expiresAt 升序
    availableItems.sort((a, b) => {
      if (a.expiresSoon && !b.expiresSoon) return -1;
      if (!a.expiresSoon && b.expiresSoon) return 1;
      if (a.expiresAt && b.expiresAt) return a.expiresAt.localeCompare(b.expiresAt);
      if (a.expiresAt) return -1;
      if (b.expiresAt) return 1;
      return 0;
    });

    // 快过期食材名称列表
    const expiringNames = availableItems.filter((item) => item.expiresSoon).map((item) => item.name);

    const avoidFoods = [...(dietProfile?.avoidFoods ?? []), ...(dietProfile?.allergies ?? [])];
    const timeLimit = params.timeLimitMinutes ?? kitchen.maxActiveMinutes;

    // 使用 matcher 评分
    const matches = matchRecipes({
      recipes,
      availableIngredients: availableItems,
      shoppingList: shoppingItems,
      kitchenProfile: kitchen,
      userProfile: dietProfile,
      feedback,
      timeLimitMinutes: timeLimit,
      energyLevel: params.energyLevel,
      desiredStyle: params.desiredStyle,
    });

    // 选择主菜：最高分
    let mainResult: MatchRecipeResult | undefined;
    // 选择蔬菜/补充菜：不与主菜完全重复，dishCount 低，activeMinutes 低
    let sideResult: MatchRecipeResult | undefined;

    if (matches.length > 0) {
      mainResult = matches[0];

      const sideCandidates = matches
        .filter((m) => {
          if (m.recipe.id === mainResult!.recipe.id) return false;
          if (m.missingIngredients.length > 0) return false;
          return true;
        })
        .sort((a, b) =>
          a.missingIngredients.length - b.missingIngredients.length ||
          a.recipe.dishCount - b.recipe.dishCount ||
          a.recipe.activeMinutes - b.recipe.activeMinutes ||
          b.score - a.score
        );

      // 尝试找一个不完全重复的配菜
      sideResult = sideCandidates.find((m) => {
        if (m.recipe.id === mainResult!.recipe.id) return false;
        // 优先含蔬菜（vegetables 非空）
        const hasVegetable = (m.recipe.vegetables ?? []).length > 0;
        // 与主菜食材不完全相同
        const sameIngredients = m.recipe.ingredients.every((ing) =>
          mainResult!.recipe.ingredients.includes(ing)
        ) && mainResult!.recipe.ingredients.every((ing) =>
          m.recipe.ingredients.includes(ing)
        );
        // 不要再选另一个烤箱大菜当配菜
        const notHeavyOven = !(m.recipe.modes?.includes("oven") && m.recipe.activeMinutes > 10);
        return hasVegetable && !sameIngredients && notHeavyOven;
      });

      // 如果没找到理想配菜，放宽条件
      if (!sideResult) {
        sideResult = sideCandidates.find((m) => {
          if (m.recipe.id === mainResult!.recipe.id) return false;
          return m.recipe.dishCount <= 2 && m.recipe.activeMinutes <= 10;
        });
      }
    }

    // 没有符合硬约束的菜谱时，不得使用不安全的兜底推荐。
    if (!mainResult) {
      return {
        content: [{ type: "text" as const, text: "没有找到符合忌口、过敏和厨房条件的安全菜谱。请补充可用厨具、调整限制或添加合适菜谱。" }],
        details: {
          userId: params.userId,
          kitchen,
          inventory,
          selectedRecipes: [] as RecipeRecord[],
          activeMinutes: 0,
          totalMinutes: 0,
          missingIngredients: [] as string[],
          mainScore: 0,
          mainReasons: [] as string[],
        },
      };
    }

    const main = mainResult.recipe;
    const side = sideResult?.recipe;
    const missing = [
      ...new Set([...mainResult.missingIngredients, ...(sideResult?.missingIngredients ?? [])]),
    ];

    const ownedNames = [...new Set([
      ...availableItems.map((item) => item.name),
    ])];
    const shoppingNames = [...new Set([
      ...names(shoppingItems),
    ])];
    // 去重合并，用于总计
    const uniqueAvailable = [...new Set([...ownedNames, ...shoppingNames])];

    const activeMinutes = Math.min(
      kitchen.maxActiveMinutes,
      Math.max(main.activeMinutes, side?.activeMinutes ?? 0) + 5
    );
    const totalMinutes = Math.max(main.totalMinutes, side?.totalMinutes ?? 0);
    const isLowEnergy = params.energyLevel === "low";

    const lines: string[] = [];

    // 推荐理由
    lines.push("## 推荐理由");
    const reasons = mainResult.reasons.length > 0 ? mainResult.reasons : ["基于综合评分推荐"];
    for (const r of reasons) {
      lines.push(`- ${r}`);
    }
    if (sideResult && sideResult.reasons.length > 0) {
      lines.push(`- 配菜 ${sideResult.recipe.name}：${sideResult.reasons.slice(0, 3).join("；")}`);
    }

    lines.push("\n## 晚饭方案");
    lines.push(`- 主菜：${main.name}`);
    if (side) lines.push(`- 蔬菜/补充：${side.name}`);
    lines.push("- 主食：优先用现成米饭、面条、馒头或烤土豆补足");
    if (params.desiredStyle) lines.push(`- 风格限制：${params.desiredStyle}`);

    lines.push("\n## 使用食材");
    lines.push(`- 库存已有：${ownedNames.join("、") || "暂无"}`);
    if (shoppingNames.length > 0) {
      // 购物清单中被本方案用到的食材
      const usedFromShopping = [...new Set([...shoppingNames])];
      if (usedFromShopping.length > 0) {
        lines.push(`- 购物清单（待购）：${usedFromShopping.join("、")}`);
      }
    }
    lines.push(`- 需要额外购买：${missing.join("、") || "无需额外购买"}`);
    if (avoidFoods.length > 0) lines.push(`- 已避开：${avoidFoods.join("、")}`);
    if (expiringNames.length > 0) {
      const expiringDetails = availableItems
        .filter((item) => item.expiresSoon)
        .map((item) => `${item.name}(${item.expiresAt})`)
        .join("、");
      lines.push(`- ⚠️ 优先消耗快过期食材：${expiringDetails}`);
    }

    lines.push("\n## 厨具安排");
    const mainModes = main.modes ?? [main.mode];
    if (mainModes.includes("oven")) {
      lines.push(`- 烤箱：${main.name}`);
      if (side) lines.push(`- 灶台 1：${side.name}`);
      if (kitchen.burners > 1) lines.push("- 灶台 2：烧水、煮蛋或处理主食，视体力可省略");
    } else {
      lines.push(`- 灶台 1：${main.name}`);
      if (side && kitchen.burners > 1) lines.push(`- 灶台 2：${side.name}`);
      lines.push(`- 烤箱：${kitchen.hasOven ? "本方案暂不需要" : "不可用"}`);
    }
    lines.push(`- 主动操作约 ${activeMinutes} 分钟，总耗时约 ${totalMinutes} 分钟`);

    lines.push("\n## 时间线");
    // 优先使用菜谱自带 timeline
    if (main.timeline && main.timeline.length > 0) {
      lines.push(`### ${main.name}`);
      lines.push(...main.timeline.map((step) => `- ${step}`));
      if (side?.timeline && side.timeline.length > 0) {
        lines.push(`\n### ${side.name}`);
        lines.push(...side.timeline.map((step) => `- ${step}`));
      }
    } else {
      // 兼容旧格式的通用时间线
      lines.push("- 0-3 分钟：清点食材，烤箱菜先预热；没有烤箱菜就先烧水/热锅。");
      if (mainModes.includes("oven")) {
        lines.push(`- 3-8 分钟：处理 ${main.name} 并送入烤箱。`);
        lines.push(`- 8-15 分钟：处理${side ? ` ${side.name}` : "蔬菜或主食"}。`);
        lines.push(`- 15-${totalMinutes} 分钟：烤箱等待，收拾台面，最后装盘。`);
      } else {
        lines.push(`- 3-12 分钟：完成 ${main.name} 的主要烹饪。`);
        if (side) lines.push(`- 12-18 分钟：完成 ${side.name}，或和主菜并行处理。`);
        lines.push(`- 18-${Math.max(totalMinutes, 20)} 分钟：装盘，保留明天可复用的剩菜。`);
      }
    }

    lines.push("\n## 详细步骤");
    lines.push(`### ${main.name}`);
    lines.push(...main.steps.map((step, index) => `${index + 1}. ${step}`));
    if (side) {
      lines.push(`\n### ${side.name}`);
      lines.push(...side.steps.map((step, index) => `${index + 1}. ${step}`));
    }

    lines.push("\n## 低能量版本");
    if (isLowEnergy) {
      lines.push("- 今天按最低能量处理：主菜保留，蔬菜尽量焯水/烤箱同盘，少开一个锅。");
    }
    lines.push(`- ${main.lowEnergySwap ?? "减少切配，使用预制/冷冻/免洗食材。"}`);
    if (side?.lowEnergySwap) lines.push(`- ${side.lowEnergySwap}`);

    lines.push("\n## 明天/周末预处理建议");
    if (main.weekendPrep) {
      lines.push(`- ${main.weekendPrep}`);
    } else {
      lines.push("- 如果今天买肉，可以多分装一份，直接用生抽、蚝油、黑胡椒腌好冷冻。");
    }
    lines.push("- 蔬菜洗切一半留明天，明天只需要下锅或丢进烤盘。");

    // 历史反馈参考
    const relatedFeedback = feedback.filter(
      (fb) => fb.recipeName && [main, side].some(
        (r) => r && (fb.recipeName!.includes(r.name) || r.name.includes(fb.recipeName!))
      )
    );
    if (relatedFeedback.length > 0) {
      lines.push("\n## 历史反馈参考");
      for (const fb of relatedFeedback) {
        const fbParts: string[] = [];
        if (fb.rating != null) fbParts.push(`上次评分 ${fb.rating}/5`);
        if (fb.wouldCookAgain === true) fbParts.push("上次推荐");
        if (fb.wouldCookAgain === false) fbParts.push("上次不推荐");
        if (fb.note) fbParts.push(`备注：${fb.note}`);
        lines.push(`- ${fb.recipeName}：${fbParts.join("；")}`);
      }
    }

    const planText = lines.join("\n");
    const selectedDishes = [main, side].filter((r): r is RecipeRecord => r !== undefined);

    store.saveMealPlan({
      userId: params.userId,
      mealType: "dinner",
      dishes: selectedDishes.map((r) => r.name),
      ingredients: [...new Set([...ownedNames, ...shoppingNames])],
      missingIngredients: missing,
      activeMinutes,
      totalMinutes,
      fullPlan: planText,
    });

    return {
      content: [{ type: "text" as const, text: planText }],
      details: {
        userId: params.userId,
        kitchen,
        inventory,
        selectedRecipes: selectedDishes,
        activeMinutes,
        totalMinutes,
        missingIngredients: missing,
        mainScore: mainResult.score,
        mainReasons: mainResult.reasons,
      },
    };
  },
});
