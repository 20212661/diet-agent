import type { RouteContext } from "../context.js";
import { readJson, sendJson } from "../helpers/http.js";

export async function handleChatRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "POST" && url.pathname === "/api/chat") {
    let payload: { message?: unknown; operationId?: unknown; retry?: unknown };
    try {
      payload = await readJson(request);
    } catch {
      sendJson(response, 400, { error: "请求内容无效。" });
      return true;
    }
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > 12_000) {
      sendJson(response, 400, { error: "请输入消息（最多 12,000 字符）。" });
      return true;
    }
    if (typeof payload.operationId !== "string" || payload.operationId.length < 8 || payload.operationId.length > 200) {
      sendJson(response, 400, { error: "请求缺少有效 operationId，请刷新页面后重试。" });
      return true;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emit = (event: unknown) => {
      if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await ctx.streamChatOperation(payload.operationId, message, payload.retry === true, emit);
    } catch (error) {
      console.error("[WEB chat state]", error instanceof Error ? error.name : typeof error);
      emit({
        type: "result_uncertain",
        status: "result_uncertain",
        reply: "无法读取或保存本次请求状态，请核对记录后再继续。系统不会自动重发。",
      });
    }
    if (!response.destroyed && !response.writableEnded) response.end();
    return true;
  }

  return false;
}
