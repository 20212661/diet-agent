import * as store from "../store/index.js";
import {
  baseIdentityPrompt,
  cookingPrompt,
  dietPrompt,
  safetyPrompt,
  toolUsagePrompt,
} from "./prompts/index.js";

function joinOrNone(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join("、") : "未记录";
}

export function buildLayeredSystemPrompt(): string {
  return [
    baseIdentityPrompt,
    toolUsagePrompt,
    cookingPrompt,
    dietPrompt,
    safetyPrompt,
  ].join("\n\n");
}

export const GLM_STRICT_COOKING_AGENT_PROMPT = buildLayeredSystemPrompt();

export function buildUserMemoryPrompt(userId: string): string {
  const userProfile = store.getUserProfile(userId);
  const kitchenProfile = store.getKitchenProfile(userId);
  const inventory = store.getIngredientInventory(userId);
  const feedback = store.getCookingFeedback(userId).slice(0, 5);

  const lines: string[] = [];
  lines.push("## 当前用户记忆摘要");
  lines.push("这些信息来自已保存数据。优先参考；如果本轮输入冲突，以本轮输入为准。");
  lines.push("");

  lines.push("### 用户");
  lines.push(`- userId：${userId}`);
  lines.push("");

  lines.push("### 饮食画像");
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
  lines.push("");

  lines.push("### 厨房画像");
  if (kitchenProfile) {
    lines.push(`- 灶台数量：${kitchenProfile.burners}`);
    lines.push(`- 烤箱：${kitchenProfile.hasOven ? "有" : "没有"}`);
    lines.push(`- 厨具：${joinOrNone(kitchenProfile.cookware)}`);
    lines.push(`- 主动操作目标：${kitchenProfile.maxActiveMinutes} 分钟`);
    lines.push(`- 总耗时上限：${kitchenProfile.maxTotalMinutes} 分钟`);
    lines.push(`- 口味偏好：${joinOrNone(kitchenProfile.tastePreferences)}`);
    lines.push(`- 做饭偏好：${joinOrNone(kitchenProfile.cookingPreferences)}`);
  } else {
    lines.push("- 暂无厨房画像，默认按 2 个灶台、1 个烤箱、主动操作 15-20 分钟规划。");
  }
  lines.push("");

  lines.push("### 食材库存");
  const available = inventory.availableIngredients.filter((item) => !item.status || item.status === "available");
  if (available.length > 0) {
    for (const item of available.slice(0, 20)) {
      const parts = [
        item.amount,
        item.storage,
        item.expiresAt ? `${item.expiresSoon ? "快过期 " : ""}${item.expiresAt}` : undefined,
        item.category,
      ].filter(Boolean);
      lines.push(`- ${item.name}${parts.length > 0 ? `：${parts.join("，")}` : ""}`);
    }
  } else {
    lines.push("- 暂无可用食材记录。");
  }

  const expiring = available.filter((item) => item.expiresSoon);
  if (expiring.length > 0) {
    lines.push(`- 快过期：${expiring.map((item) => `${item.name}${item.expiresAt ? `(${item.expiresAt})` : ""}`).join("、")}`);
  }
  if (inventory.shoppingList.length > 0) {
    lines.push(`- 购物清单：${inventory.shoppingList.map((item) => item.name).join("、")}`);
  }
  lines.push("");

  lines.push("### 近期做饭反馈");
  if (feedback.length > 0) {
    for (const fb of feedback) {
      const parts: string[] = [];
      if (fb.recipeName) parts.push(fb.recipeName);
      if (fb.rating != null) parts.push(`评分 ${fb.rating}/5`);
      if (fb.wouldCookAgain === true) parts.push("下次推荐");
      if (fb.wouldCookAgain === false) parts.push("不推荐");
      if (fb.tooTiring) parts.push("太累");
      if (fb.tooManyDishes) parts.push("洗碗多");
      if (fb.actualActiveMinutes != null) parts.push(`主动 ${fb.actualActiveMinutes} 分钟`);
      if (fb.actualTotalMinutes != null) parts.push(`总耗时 ${fb.actualTotalMinutes} 分钟`);
      if (fb.note) parts.push(`备注：${fb.note}`);
      lines.push(`- ${parts.join("；")}`);
    }
  } else {
    lines.push("- 暂无做饭反馈。");
  }
  lines.push("");

  lines.push("### 本周菜单");
  const weeklyPlan = store.getWeeklyPlan(userId);
  if (weeklyPlan && weeklyPlan.days.length > 0) {
    const completedCount = weeklyPlan.days.filter((d) => d.completed).length;
    lines.push(`- 状态：${weeklyPlan.status}，${completedCount}/${weeklyPlan.days.length} 天已完成`);
    for (const day of weeklyPlan.days) {
      const label = DAY_LABELS[day.dayOfWeek] ?? `周${day.dayOfWeek}`;
      const check = day.completed ? "已完成" : "未做";
      const side = day.sideRecipe ? ` + ${day.sideRecipe.name}` : "";
      lines.push(`- ${label} (${day.date}) [${check}]：${day.mainRecipe.name}${side}，主食：${day.staplesSuggestion}`);
    }
  } else {
    lines.push("- 暂无本周菜单。");
  }
  lines.push("");

  return lines.join("\n");
}

const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
