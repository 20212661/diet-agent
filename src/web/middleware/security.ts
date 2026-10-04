import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { sendJson } from "../helpers/http.js";

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const API_POST_PATHS = new Set([
  "/api/profile",
  "/api/kitchen",
  "/api/inventory",
  "/api/inventory/items",
  "/api/inventory/import",
  "/api/meals",
  "/api/weekly-plan/day/complete",
  "/api/shopping-list/add-from-plan",
  "/api/receipt/parse",
  "/api/chat",
  "/api/model/check",
]);

export function normalizeHostName(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "");
}

export function isLoopbackHost(value: string): boolean {
  const normalized = normalizeHostName(value);
  return LOOPBACK_HOSTS.has(normalized) && (normalized === "localhost" || isIP(normalized) > 0);
}

export function hasAllowedOrigin(request: IncomingMessage, port: number): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || Number(parsed.port || 80) !== port || parsed.username || parsed.password) return false;
    return LOOPBACK_HOSTS.has(normalizeHostName(parsed.hostname));
  } catch {
    return false;
  }
}

export function hasAllowedHostHeader(request: IncomingMessage, port: number): boolean {
  const hostHeader = request.headers.host;
  if (!hostHeader) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    return LOOPBACK_HOSTS.has(normalizeHostName(parsed.hostname)) && Number(parsed.port || 80) === port;
  } catch {
    return false;
  }
}

export function isApiWriteRoute(method: string, path: string): boolean {
  return API_POST_PATHS.has(path)
    || path.startsWith("/api/inventory/items/")
    || /^\/api\/weekly-plan\/[^/]+\/day\/[^/]+\/(?:replace|complete)$/.test(path)
    || /^\/api\/meals\/[^/]+(?:\/restore)?$/.test(path);
}

export function verifySecurity(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  url: URL,
): boolean {
  if (!hasAllowedHostHeader(request, port)) {
    sendJson(response, 421, { error: "该服务只接受发往本机回环地址的请求。" });
    return false;
  }

  if (["POST", "PATCH", "DELETE"].includes(request.method ?? "") && isApiWriteRoute(request.method!, url.pathname)) {
    if (!hasAllowedOrigin(request, port)) {
      sendJson(response, 403, { error: "跨站请求已拒绝。" });
      return false;
    }
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      sendJson(response, 415, { error: "请求必须使用 application/json。" });
      return false;
    }
  }

  return true;
}

/** Bind browser writes to the identity loaded with their dashboard. This is not login authentication. */
export function verifyRequestUser(request: IncomingMessage, response: ServerResponse, userId: string): boolean {
  let requestedUser: string | undefined;
  try {
    const header = request.headers["x-diet-user-id"];
    if (typeof header === "string") requestedUser = decodeURIComponent(header);
  } catch {
    // A malformed identity is rejected in the same way as a stale or missing one.
  }
  if (requestedUser !== userId) {
    sendJson(response, 409, { code: "user_changed", error: "当前服务用户已变化或请求缺少用户标识，请刷新页面后核对。" });
    return false;
  }
  return true;
}
