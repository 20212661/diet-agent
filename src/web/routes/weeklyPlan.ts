import type { RouteContext } from "../context.js";
import * as store from "../../store/index.js";
import { findRecipe, getWeeklyPlanAlternatives, replacePlanDayRecipe } from "../../services/weeklyPlanService.js";
import { isValidIsoDate } from "../../utils/date.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";

export async function handleWeeklyPlanRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  const recipeMatch = /^\/api\/recipes\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && recipeMatch) {
    const recipe = findRecipe(decodeURIComponent(recipeMatch[1]!));
    sendJson(response, recipe ? 200 : 404, recipe ? { recipe } : { error: "找不到这道菜谱。" });
    return true;
  }

  const alternativesMatch = /^\/api\/weekly-plan\/([^/]+)\/day\/([^/]+)\/alternatives$/.exec(url.pathname);
  if (request.method === "GET" && alternativesMatch) {
    const weekStartDate = decodeURIComponent(alternativesMatch[1]!);
    const date = decodeURIComponent(alternativesMatch[2]!);
    if (!isValidIsoDate(weekStartDate) || !isValidIsoDate(date)) {
      sendJson(response, 400, { error: "日期格式无效。" });
      return true;
    }
    const result = getWeeklyPlanAlternatives(ctx.userId, weekStartDate, date);
    sendJson(response, result.status === "ok" ? 200 : 404, result);
    return true;
  }

  const planReplaceMatch = /^\/api\/weekly-plan\/([^/]+)\/day\/([^/]+)\/replace$/.exec(url.pathname);
  if (request.method === "POST" && planReplaceMatch) {
    const weekStartDate = decodeURIComponent(planReplaceMatch[1]!);
    const date = decodeURIComponent(planReplaceMatch[2]!);
    try {
      const payload = await readJson(request);
      if (!isValidIsoDate(weekStartDate) || !isValidIsoDate(date) || typeof payload.updatedAt !== "string" || typeof payload.recipeId !== "string") {
        throw new Error("计划日期、版本或菜谱 ID 无效。");
      }
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        replacePlanDayRecipe(ctx.userId, weekStartDate, date, payload.updatedAt as string, payload.recipeId as string));
      if (result.status === "conflict") sendJson(response, 409, { error: "计划已更新，请刷新后重试。", plan: result.plan });
      else if (result.status === "not_found") sendJson(response, 404, { error: "找不到这一天的计划。" });
      else if (result.status === "invalid_recipe") sendJson(response, 422, { error: "所选菜谱不在当前安全筛选后的候选中，请重新选择。" });
      else sendJson(response, 200, { saved: true, plan: result.plan });
    } catch (error) {
      sendWriteError(response, error, "更换菜谱失败。");
    }
    return true;
  }

  const planCompleteMatch = /^\/api\/weekly-plan\/([^/]+)\/day\/([^/]+)\/complete$/.exec(url.pathname);
  if (request.method === "POST" && planCompleteMatch) {
    const weekStartDate = decodeURIComponent(planCompleteMatch[1]!);
    const date = decodeURIComponent(planCompleteMatch[2]!);
    try {
      const payload = await readJson(request);
      if (!isValidIsoDate(weekStartDate) || !isValidIsoDate(date) || typeof payload.updatedAt !== "string" || typeof payload.recipeId !== "string" || typeof payload.completed !== "boolean") {
        throw new Error("计划日期、版本或完成状态无效。");
      }
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.setWeeklyPlanDayCompleted(ctx.userId, weekStartDate, date, payload.recipeId as string, payload.updatedAt as string, payload.completed as boolean));
      if (result.status === "conflict") sendJson(response, 409, { error: "计划已更新，请刷新后重试。", plan: result.plan });
      else if (result.status === "not_found") sendJson(response, 404, { error: "找不到这一天的计划。" });
      else sendJson(response, 200, { saved: true, plan: result.plan });
    } catch (error) {
      sendWriteError(response, error, "更新完成状态失败。");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/shopping-list/add-from-plan") {
    try {
      const payload = await readJson(request);
      if (typeof payload.weekStartDate !== "string" || typeof payload.date !== "string" || typeof payload.updatedAt !== "string" || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100 || !Array.isArray(payload.recipeIds)) {
        throw new Error("计划版本和待加入食材无效。");
      }
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () => {
        const plan = store.getWeeklyPlan(ctx.userId, payload.weekStartDate as string);
        if (!plan || plan.updatedAt !== payload.updatedAt) return { status: "conflict" as const, plan };
        const day = plan.days.find((item) => item.date === payload.date);
        if (!day) return { status: "not_found" as const };
        const currentRecipeIds = [day.mainRecipe.id, ...(day.sideRecipe ? [day.sideRecipe.id] : [])].sort();
        const rawRecipeIds = payload.recipeIds as unknown[];
        const requestedRecipeIds = rawRecipeIds.filter((item): item is string => typeof item === "string").sort();
        if (requestedRecipeIds.length !== rawRecipeIds.length || JSON.stringify(currentRecipeIds) !== JSON.stringify(requestedRecipeIds)) return { status: "conflict" as const, plan };
        const eligible = new Set(day.ingredientReadiness?.filter((item) => item.status === "to_add_to_list").map((item) => item.ingredient) ?? []);
        const rawItems = payload.items as unknown[];
        const requested = [...new Set(rawItems.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
        if (!requested.length || requested.length !== rawItems.length || requested.some((item) => !eligible.has(item))) return { status: "invalid_items" as const };
        const inventory = store.upsertIngredientInventory(ctx.userId, {
          shoppingList: requested.map((name) => ({ name, status: "planned" as const })),
        });
        return { status: "updated" as const, inventory, plan: store.getWeeklyPlan(ctx.userId, payload.weekStartDate as string) };
      });
      if (result.status === "conflict") sendJson(response, 409, { error: "计划或库存状态已变化，请刷新后核对。", plan: result.plan });
      else if (result.status === "not_found") sendJson(response, 404, { error: "找不到这一天的计划。" });
      else if (result.status === "invalid_items") sendJson(response, 422, { error: "只能加入当前标记为待加入采购清单的食材。" });
      else sendJson(response, 200, { saved: true, inventory: result.inventory, plan: result.plan, updatedAt: result.inventory.updatedAt });
    } catch (error) {
      sendWriteError(response, error, "加入采购清单失败。");
    }
    return true;
  }

  return false;
}
