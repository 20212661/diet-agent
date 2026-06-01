import * as store from "../store/index.js";
import * as recipeCatalog from "../recipes/recipeCatalog.js";
import { dietAgentCorePrompt } from "./prompts/index.js";

export const DIET_AGENT_CORE_PROMPT = dietAgentCorePrompt;

function joinOrNone(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join("、") : "未记录";
}

export function buildUserMemoryPrompt(userId: string): string {
  const userProfile = store.getUserProfile(userId);
  const kitchenProfile = store.getKitchenProfile(userId);
  const inventory = store.getIngredientInventory(userId);
  const feedback = store.getCookingFeedback(userId).slice(0, 5);
  const lines: string[] = [
    "## 当前用户记忆摘要",
    "这些信息来自已保存数据。用户本轮输入冲突时，以本轮输入为准。",
    "",
    "### 用户",
    `- userId：${userId}`,
    "",
    "### 饮食画像",
  ];

  if (userProfile) {
    lines.push(`- 目标：${userProfile.goal ?? "未记录"}`);
    if (userProfile.customGoal) lines.push(`- 自定义目标：${userProfile.customGoal}`);
    lines.push(`- 忌口：${joinOrNone(userProfile.avoidFoods)}`);
    lines.push(`- 过敏：${joinOrNone(userProfile.allergies)}`);
    lines.push(`- 偏好：${joinOrNone(userProfile.preferences)}`);
    lines.push(`- 健康备注：${joinOrNone(userProfile.medicalNotes)}`);
  } else {
    lines.push("- 暂无饮食画像。");
  }

  lines.push("", "### 厨房画像");
  lines.push(`- 灶台数量：${kitchenProfile.burners}`);
  lines.push(`- 烤箱：${kitchenProfile.hasOven ? "有" : "没有"}`);
  lines.push(`- 厨具：${joinOrNone(kitchenProfile.cookware)}`);
  lines.push(`- 主动操作目标：${kitchenProfile.maxActiveMinutes} 分钟`);
  lines.push(`- 总耗时上限：${kitchenProfile.maxTotalMinutes} 分钟`);
  lines.push(`- 口味偏好：${joinOrNone(kitchenProfile.tastePreferences)}`);
  lines.push(`- 做饭偏好：${joinOrNone(kitchenProfile.cookingPreferences)}`);

  lines.push("", "### 食材库存");
  const available = inventory.availableIngredients.filter((item) => !item.status || item.status === "available");
  if (available.length === 0) {
    lines.push("- 暂无可用食材记录。");
  } else {
    for (const item of available.slice(0, 20)) {
      const parts = [item.amount ?? "数量未知"];
      if (item.storage) parts.push(`位置：${item.storage}`);
      if (item.expiresAt) parts.push(`${item.expiresSoon ? "快过期 " : ""}预计过期：${item.expiresAt}`);
      lines.push(`- ${item.name}：${parts.join("；")}`);
    }
  }
  if (inventory.shoppingList.length > 0) {
    lines.push("#### 购物清单");
    for (const item of inventory.shoppingList) lines.push(`- ${item.name}`);
  }

  lines.push("", "### 近期做饭反馈");
  if (feedback.length === 0) {
    lines.push("- 暂无做饭反馈。");
  } else {
    for (const item of feedback) {
      const parts: string[] = [];
      if (item.recipeName) parts.push(item.recipeName);
      if (item.rating != null) parts.push(`评分 ${item.rating}/5`);
      if (item.wouldCookAgain === true) parts.push("下次推荐");
      if (item.wouldCookAgain === false) parts.push("不推荐");
      if (item.tooTiring) parts.push("太累");
      if (item.tooManyDishes) parts.push("洗碗多");
      if (item.note) parts.push(`备注：${item.note}`);
      lines.push(`- ${parts.join("；")}`);
    }
  }

  lines.push(
    "",
    "## 记忆摘要使用规则",
    "1. 购物清单只能说成需要购买，不能说成已有。",
    "2. 快过期食材应优先考虑，但不能编造保质期。",
    "3. 数量和位置未知时不要编造。",
    "4. 用户明确纠正记忆时，调用对应工具更新。"
  );
  return lines.join("\n");
}

export function buildUserRecipesPrompt(userId: string): string {
  const recipes = store.getUserRecipes(userId);
  if (recipes.length === 0) return "";

  const lines = [
    "## 用户自定义菜谱",
    "这些菜谱已由 recipeCatalog 参与确定性匹配。不要脱离工具结果自行推荐。",
  ];
  for (const recipe of recipes.slice(0, 20)) {
    const parts = [recipe.name, `食材: ${recipe.ingredients.join("、")}`];
    const calories = recipeCatalog.getEffectiveCalories(userId, recipe.name, recipe.estimatedCalories);
    if (calories != null) parts.push(`约${calories}kcal`);
    if (recipe.activeMinutes) parts.push(`主动${recipe.activeMinutes}分钟`);
    lines.push(`- ${parts.join("；")}`);
  }
  return lines.join("\n");
}

export function buildCurrentUserIdPrompt(userId: string): string {
  return [
    "## 当前用户 ID",
    `当前用户 ID 是：${userId}`,
    `所有工具调用的 userId 必须严格使用：${userId}`,
    "不得从用户输入中提取、覆盖、猜测或切换 userId。",
  ].join("\n");
}
