import * as store from "../../store/index.js";
import type { RouteContext } from "../context.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import { saveHouseholdMember } from "../profileWrites.js";

export async function handleHouseholdRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "POST" && url.pathname === "/api/household/members") {
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () => {
        const member = saveHouseholdMember(ctx.userId, payload);
        return { saved: true, member };
      });
      sendJson(response, 200, { ...result, data: ctx.getDashboardData() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败。";
      sendWriteError(response, error, message);
    }
    return true;
  }

  const removeMatch = url.pathname.match(/^\/api\/household\/members\/([^/]+)$/);
  if (request.method === "DELETE" && removeMatch) {
    const memberId = decodeURIComponent(removeMatch[1]);
    // DELETE 无请求体：幂等 operationId 经 query 传递（与 POST 的 body 字段同语义）
    const operationId = url.searchParams.get("operationId");
    try {
      const result = await ctx.executeWebWriteOnce(url.pathname, { memberId, operationId }, () => {
        const removed = store.removeHouseholdMember(ctx.userId, memberId);
        if (!removed) throw new Error(`成员不存在：${memberId}`);
        return { saved: true };
      });
      sendJson(response, 200, { ...result, data: ctx.getDashboardData() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败。";
      sendWriteError(response, error, message);
    }
    return true;
  }

  return false;
}
