import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import { matchRecipes } from "../recipes/recipeMatcher.js";
import { getRetriever } from "../rag/index.js";
import type { EnergyLevel, IngredientItem } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  query: Type.Optional(Type.String({ description: "想搜索的菜名、食材、风格或目标" } as const)),
  ingredients: Type.Optional(Type.Array(Type.String(), { description: "本次明确可用的食材" } as const)),
  timeLimitMinutes: Type.Optional(Type.Number({ description: "主动操作时间上限，分钟" } as const)),
  energyLevel: Type.Optional(
    Type.Union([Type.Literal("low"), Type.Literal("normal")], { description: "精力状态" } as const)
  ),
  limit: Type.Optional(Type.Number({ description: "返回数量，默认 5，最多 10" } as const)),
});

type ParamsType = Static<typeof Params>;

function toItems(names: string[] | undefined): IngredientItem[] {
  return (names ?? []).map((name) => ({ name }));
}

function recipeTextMatches(recipe: { name: string; ingredients: string[]; preferenceTags?: string[]; tasteTags?: string[] }, query?: string) {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  const haystack = [
    recipe.name,
    ...recipe.ingredients,
    ...(recipe.preferenceTags ?? []),
    ...(recipe.tasteTags ?? []),
  ].join(" ").toLowerCase();
  return haystack.includes(q) || q.split(/\s+/).some((part) => part && haystack.includes(part));
}

export const searchRecipesTool: ToolDefinition<typeof Params> = defineTool({
  name: "search_recipes",
  label: "搜索菜谱",
  description:
    "基于菜谱库、用户库存、厨房条件、反馈和时间限制搜索/排序菜谱。用户问有什么菜谱、某些食材能做什么、想看候选方案但还不需要完整做饭步骤时调用。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const kitchen = store.getKitchenProfile(params.userId);
    const inventory = store.getIngredientInventory(params.userId);
    const userProfile = store.getUserProfile(params.userId);
    const feedback = store.getCookingFeedback(params.userId);
    // 候选菜谱：有自然语言 query 时优先 RAG 语义召回（top-20），否则用关键词预筛
    let recipes = store.getRecipeBook().filter((recipe) => recipeTextMatches(recipe, params.query));
    if (params.query?.trim()) {
      const retriever = await getRetriever();
      if (retriever) {
        try {
          const recalled = await retriever.recall(params.query, 20);
          if (recalled.recipes.length > 0) {
            recipes = recalled.recipes;
          }
        } catch (e) {
          console.warn(`[RAG] recall failed, fallback to keyword filter: ${(e as Error).message}`);
        }
      }
    }
    const availableIngredients = [
      ...inventory.availableIngredients.filter((item) => !item.status || item.status === "available"),
      ...toItems(params.ingredients),
    ];

    const matches = matchRecipes({
      recipes,
      availableIngredients,
      shoppingList: inventory.shoppingList,
      kitchenProfile: kitchen,
      userProfile,
      feedback,
      timeLimitMinutes: params.timeLimitMinutes,
      energyLevel: params.energyLevel as EnergyLevel | undefined,
      desiredStyle: params.query,
    }).slice(0, Math.min(Math.max(params.limit ?? 5, 1), 10));

    const lines: string[] = [];
    if (matches.length === 0) {
      lines.push("没有找到合适的菜谱候选。可以补充食材、时间限制或想吃的风格。");
    } else {
      lines.push("菜谱候选：");
      for (const match of matches) {
        const missing = match.missingIngredients.length > 0
          ? `；缺：${match.missingIngredients.join("、")}`
          : "";
        lines.push(`- ${match.recipe.name}（评分 ${match.score}，主动 ${match.recipe.activeMinutes} 分钟，总计 ${match.recipe.totalMinutes} 分钟${missing}）`);
        for (const reason of match.reasons.slice(0, 3)) {
          lines.push(`  - ${reason}`);
        }
      }
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { matches },
    };
  },
});
