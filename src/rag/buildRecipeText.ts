/**
 * 把菜谱拼成供 embedding 的检索文本。
 *
 * 菜谱没有纯描述字段（无 description/summary），用结构化字段拼语义文本。
 * 拼接顺序兼顾「菜名 + 食材」这类强信号与「口味/季节/目标」等语义信号，
 * 让向量检索能处理「清爽的夏日菜」「适合减脂的高蛋白」这类模糊查询。
 */
import type { RecipeRecord } from "../types/diet.js";

export function buildRecipeText(recipe: RecipeRecord): string {
  const ingredients = [...recipe.ingredients, ...(recipe.optionalIngredients ?? [])];
  const steps = (recipe.steps ?? []).slice(0, 3);

  const parts: string[] = [
    recipe.name,
    ingredients.length ? `食材：${ingredients.join("、")}` : "",
    recipe.primaryProtein ? `主蛋白：${recipe.primaryProtein}` : "",
    recipe.vegetables.length ? `蔬菜：${recipe.vegetables.join("、")}` : "",
    recipe.staples.length ? `主食：${recipe.staples.join("、")}` : "",
    recipe.tasteTags.length ? `口味：${recipe.tasteTags.join("、")}` : "",
    recipe.preferenceTags.length ? `特点：${recipe.preferenceTags.join("、")}` : "",
    recipe.seasonTags?.length ? `季节：${recipe.seasonTags.join("、")}` : "",
    recipe.suitableGoals.length ? `适合目标：${recipe.suitableGoals.join("、")}` : "",
    recipe.modes.length ? `烹饪方式：${recipe.modes.join("、")}` : "",
    steps.length ? `做法摘要：${steps.join("；")}` : "",
  ];

  return parts.filter((p) => p.length > 0).join("\n");
}

/** 计算检索文本的短 hash，用于增量 reindex（文本未变则不重复 embed）。 */
export function hashRecipeText(text: string): string {
  // FNV-1a 32 位，足够区分文本变更，且不依赖 crypto（避免 ESM hash 问题）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
