import type { RouteContext } from "../context.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import { saveKitchen, saveProfile } from "../profileWrites.js";

export async function handleProfileRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "POST" && ["/api/profile", "/api/kitchen"].includes(url.pathname)) {
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () => {
        if (url.pathname === "/api/profile") saveProfile(ctx.userId, payload);
        else saveKitchen(ctx.userId, payload);
        return { saved: true };
      });
      sendJson(response, 200, { ...result, data: ctx.getDashboardData() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败。";
      sendWriteError(response, error, message);
    }
    return true;
  }

  return false;
}
