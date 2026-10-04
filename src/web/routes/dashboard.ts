import type { RouteContext } from "../context.js";
import { checkModelConfiguration } from "../../agent/configDoctor.js";
import { sendJson } from "../helpers/http.js";

export async function handleDashboardRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    try {
      sendJson(response, 200, ctx.getDashboardData());
    } catch (error) {
      console.error("[WEB dashboard]", error instanceof Error ? error.name : typeof error);
      sendJson(response, 500, { error: "读取本地饮食数据失败。" });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/model/check") {
    try {
      const latestModelCheck = await checkModelConfiguration();
      ctx.setLatestModelCheck(latestModelCheck);
      sendJson(response, 200, { modelCheck: latestModelCheck, data: ctx.getDashboardData() });
    } catch (error) {
      console.error("[WEB model check]", error instanceof Error ? error.name : typeof error);
      const latestModelCheck = {
        ok: false,
        severity: "error" as const,
        code: "network_error" as const,
        message: "连接验证未能完成。",
        nextStep: "检查网络和模型配置，然后运行 npm run doctor。",
      };
      ctx.setLatestModelCheck(latestModelCheck);
      sendJson(response, 200, { modelCheck: latestModelCheck, data: ctx.getDashboardData() });
    }
    return true;
  }

  return false;
}
