import { createHmac } from "node:crypto";

export class ShoppingApiError extends Error {
  constructor(message: string, public status = 502, public code = "upstream_error") { super(message); }
}
export function taobaoConfig() {
  const appKey = process.env.TAOBAO_UNION_APP_KEY?.trim() ?? "";
  const secret = process.env.TAOBAO_UNION_APP_SECRET?.trim() ?? "";
  const pid = process.env.TAOBAO_UNION_PID?.trim() ?? "";
  return { appKey, secret, pid, configured: Boolean(appKey && secret && pid) };
}
export function signTaobao(parameters: Record<string, string>, secret: string): string {
  const content = Object.keys(parameters).filter(k => k !== "sign" && parameters[k] !== "").sort().map(k => k + parameters[k]).join("");
  return createHmac("md5", secret).update(content, "utf8").digest("hex").toUpperCase();
}
export function taobaoTimestamp(date = new Date()): string {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}
export type JsonObject = Record<string, unknown>;
let activeRequests = 0;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShoppingApiError("平台响应格式异常，请稍后重试。");
  return value as JsonObject;
}
export async function callTaobao(action: "query" | "get", query: JsonObject): Promise<JsonObject> {
  const config = taobaoConfig();
  if (!config.configured) throw new ShoppingApiError("请先在本机 .env 配置淘宝闪购联盟 AppKey、AppSecret 和渠道 PID，再重启服务。", 503, "unconfigured");
  const method = `alibaba.alsc.union.eleme.promotion.storepromotion.${action}`;
  const params: Record<string, string> = { method, app_key: config.appKey, sign_method: "hmac", timestamp: taobaoTimestamp(), format: "json", v: "2.0", simplify: "false", query_request: JSON.stringify({ ...query, pid: config.pid }) };
  params.sign = signTaobao(params, config.secret);
  if (activeRequests >= 4) throw new ShoppingApiError("平台查询较多，请稍后重试。", 429, "rate_limited");
  activeRequests++;
  try {
    // Keep credentials in the POST body; never follow redirects or log upstream bodies.
    const response = await fetch("https://eco.taobao.com/router/rest", { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params) });
    if (!response.ok) throw new ShoppingApiError("平台暂时不可用，请稍后重试或使用手动购物入口。");
    if (!response.body) throw new ShoppingApiError("平台响应为空。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw new ShoppingApiError("平台响应过大。"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (body.error_response) throw new ShoppingApiError("平台拒绝调用，请核对联盟应用权限、凭证、PID 和本机时间。", 502, "permission_or_config");
    const result = object(body[method.replaceAll(".", "_") + "_response"]);
    if (result.result_code !== 0 && result.result_code !== "0") throw new ShoppingApiError("平台业务请求失败，请核对权限或稍后重试。", 502, "business_error");
    return object(result.data);
  } catch (error) {
    if (error instanceof ShoppingApiError) throw error;
    throw new ShoppingApiError("平台请求超时、网络失败或响应无效；可继续复制清单自行购买。", 502, "network_or_response");
  } finally { activeRequests--; }
}
