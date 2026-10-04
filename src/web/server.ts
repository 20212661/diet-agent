import { createServer, type Server } from "node:http";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModelCandidates, resolveModelRequests } from "../agent/modelAdapter.js";
import type { ModelCheckResult } from "../agent/configDoctor.js";
import { dietAgentTools } from "../agent/createDietAgent.js";
import * as store from "../store/index.js";
import { todayDate } from "../store/shared.js";
import { createChatOperationHandler } from "./chatStream.js";
import type { RouteContext, RouteHandler, WebContext } from "./context.js";
import { sendJson } from "./helpers/http.js";
import { serveStaticFile } from "./helpers/staticFiles.js";
import { verifyRequestUser, verifySecurity } from "./middleware/security.js";
import { handleChatRoutes } from "./routes/chat.js";
import { handleDashboardRoutes } from "./routes/dashboard.js";
import { handleInventoryRoutes } from "./routes/inventory.js";
import { handleMealRoutes } from "./routes/meals.js";
import { handleProfileRoutes } from "./routes/profile.js";
import { handleWeeklyPlanRoutes } from "./routes/weeklyPlan.js";
import { executeWebWriteOnce as persistWebWriteOnce } from "./writeOnce.js";

export interface CreateWebServerOptions {
  userId: string;
  port: number;
  host: string;
  publicDir?: string;
}

export function createWebServer(options: CreateWebServerOptions): Server {
  const { userId, port, host } = options;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  const publicDir = options.publicDir ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "public");

  let latestModelCheck: ModelCheckResult | null = null;
  const streamChatOperation = createChatOperationHandler(userId);

  function getDashboardData() {
    const date = todayDate();
    const profile = store.getUserProfile(userId);
    const kitchen = store.getKitchenProfile(userId);
    const inventory = store.getIngredientInventory(userId);
    const today = store.getTodaySummary(userId, date);
    const weeklyPlan = store.getWeeklyPlan(userId);
    const candidates = resolveModelCandidates();
    const configured = resolveModelRequests().length > 0;
    const modelStatus = !configured
      ? "unconfigured"
      : !latestModelCheck || latestModelCheck.code === "remote_check_unavailable"
        ? "configured_unverified"
        : latestModelCheck.ok && latestModelCheck.severity === "ok"
          ? "verified"
          : "failed";
    return {
      userId,
      date,
      profile,
      kitchen,
      inventory,
      today,
      weeklyPlan,
      agent: {
        model: candidates[0]?.label ?? "未配置",
        status: modelStatus,
        modelCheck: latestModelCheck,
        tools: dietAgentTools.map((tool) => ({ name: tool.name, label: tool.label, description: tool.description })),
        dataFile: basename(store.getDatabasePath()),
      },
    };
  }

  function executeWebWriteOnce<T>(route: string, payload: Record<string, unknown>, action: () => T): T {
    return persistWebWriteOnce(store.getDatabase(), userId, route, payload, action);
  }

  const webContext: WebContext = {
    userId,
    port,
    urlHost,
    publicDir,
    getDashboardData,
    getLatestModelCheck: () => latestModelCheck,
    setLatestModelCheck: (result) => {
      latestModelCheck = result;
    },
    executeWebWriteOnce,
    streamChatOperation,
  };

  const routes: RouteHandler[] = [
    handleDashboardRoutes,
    handleWeeklyPlanRoutes,
    handleMealRoutes,
    handleProfileRoutes,
    handleInventoryRoutes,
    handleChatRoutes,
  ];

  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      const boundPort = address && typeof address === "object" ? address.port : port;
      const url = new URL(request.url ?? "/", `http://${urlHost}:${boundPort}`);

      if (!verifySecurity(request, response, boundPort, url)) {
        return;
      }
      // Validate every segment before any route decodes parameters, including unknown routes.
      try {
        for (const segment of url.pathname.split("/")) decodeURIComponent(segment);
      } catch {
        sendJson(response, 400, { error: "路径编码无效。" });
        return;
      }
      if (url.pathname.startsWith("/api/") && ["POST", "PATCH", "DELETE"].includes(request.method ?? "")
        && !verifyRequestUser(request, response, userId)) return;

      const routeCtx: RouteContext = {
        ...webContext,
        request,
        response,
        url,
      };

      for (const route of routes) {
        if (await route(routeCtx)) return;
      }

      if (request.method === "GET" && (await serveStaticFile(publicDir, url.pathname, response))) {
        return;
      }

      sendJson(response, 404, { error: "未找到页面。" });
    } catch (error) {
      console.error("[WEB request]", error instanceof Error ? error.name : typeof error);
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) response.end();
      else sendJson(response, 500, { error: "请求处理失败，请核对记录后重试。" });
    }
  });
  return server;
}
