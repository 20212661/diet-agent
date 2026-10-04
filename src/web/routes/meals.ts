import type { RouteContext } from "../context.js";
import * as store from "../../store/index.js";
import { todayDate } from "../../store/shared.js";
import { isValidIsoDate } from "../../utils/date.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import { parseMealPayload } from "../payloadValidation.js";

export async function handleMealRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "GET" && url.pathname === "/api/meals/dates") {
    sendJson(response, 200, { dates: store.getMealLogDates(ctx.userId, Number(url.searchParams.get("limit") ?? 30)) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/meals") {
    const date = url.searchParams.get("date") ?? todayDate();
    if (!isValidIsoDate(date)) {
      sendJson(response, 400, { error: "日期格式无效。" });
      return true;
    }
    sendJson(response, 200, {
      date,
      meals: store.getMealLogsByDate(ctx.userId, date),
      deletedMeals: store.getDeletedMealLogsByDate(ctx.userId, date),
      summary: store.getTodaySummary(ctx.userId, date),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/meals") {
    try {
      const payload = await readJson(request);
      const meal = parseMealPayload(payload, true);
      const saved = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.addMealLog({
          userId: ctx.userId,
          ...meal,
          mealType: meal.mealType!,
          foods: meal.foods!,
          operationId: payload.operationId as string,
        }));
      sendJson(response, 201, { saved: true, meal: saved });
    } catch (error) {
      sendWriteError(response, error, "记录饮食失败。");
    }
    return true;
  }

  const mealDeleteMatch = /^\/api\/meals\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PATCH" && mealDeleteMatch) {
    try {
      const mealLogId = decodeURIComponent(mealDeleteMatch[1]!);
      const payload = await readJson(request);
      const patch = parseMealPayload(payload, false);
      const meal = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.updateMealLog({
          userId: ctx.userId,
          operationId: payload.operationId as string,
          mealLogId,
          ...patch,
        }));
      sendJson(response, meal ? 200 : 404, meal ? { saved: true, meal } : { error: "找不到这条饮食记录。" });
    } catch (error) {
      sendWriteError(response, error, "修改饮食记录失败。");
    }
    return true;
  }

  if (request.method === "DELETE" && mealDeleteMatch) {
    try {
      const mealLogId = decodeURIComponent(mealDeleteMatch[1]!);
      const payload = await readJson(request);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.undoMealLog(ctx.userId, mealLogId, payload.operationId as string));
      sendJson(response, 200, { ...result, deleted: result.undone });
    } catch (error) {
      sendWriteError(response, error, "移除饮食记录失败。");
    }
    return true;
  }

  const mealRestoreMatch = /^\/api\/meals\/([^/]+)\/restore$/.exec(url.pathname);
  if (request.method === "POST" && mealRestoreMatch) {
    try {
      const mealLogId = decodeURIComponent(mealRestoreMatch[1]!);
      const payload = await readJson(request);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.restoreMealLog(ctx.userId, mealLogId, payload.operationId as string));
      sendJson(response, 200, result);
    } catch (error) {
      sendWriteError(response, error, "恢复饮食记录失败。");
    }
    return true;
  }

  return false;
}
