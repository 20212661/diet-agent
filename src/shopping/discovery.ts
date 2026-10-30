import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "../store/database.js";
import { callTaobao, object, ShoppingApiError, taobaoConfig, type JsonObject } from "./taobaoClient.js";
import type { ShoppingProvider } from "./types.js";

const RESULT_TTL = 5 * 60_000, LINK_TTL = 2 * 60_000, CHECK_TTL = 24 * 3600_000;
function fingerprint() {
  const {appKey, secret, pid} = taobaoConfig();
  return createHash("sha256").update(JSON.stringify([appKey, secret, pid])).digest("hex");
}
function string(value: unknown, max = 200): string { return typeof value === "string" ? value.slice(0, max) : ""; }
function price(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
export function officialApiStatus(userId: string, provider: ShoppingProvider) {
  if (provider === "meituan") return {configured: false, status: "pending_official_sdk", scope: "商品券查询，生鲜覆盖未确认", storeSearch: false, purchaseLink: false, checkedAt: null};
  const configured = taobaoConfig().configured;
  const rows = getDatabase().prepare("SELECT capability, status, checked_at FROM shopping_provider_checks WHERE user_id=? AND provider=? AND credential_hash=? AND checked_at>?")
    .all(userId, provider, fingerprint(), new Date(Date.now() - CHECK_TTL).toISOString()) as {capability: string; status: string; checked_at: string}[];
  const search = rows.find(r => r.capability === "storeSearch"), link = rows.find(r => r.capability === "purchaseLink");
  return {configured, status: !configured ? "unconfigured" : search?.status === "verified" ? "verified" : search?.status === "failed" ? "failed" : "pending_verification",
    scope: "附近门店名称搜索；供给、规格、配送范围需在平台核对", storeSearch: configured && search?.status === "verified", purchaseLink: configured && link?.status === "verified", checkedAt: search?.checked_at ?? null};
}
function check(userId: string, hash: string, capability: string, status: string) {
  getDatabase().prepare("INSERT INTO shopping_provider_checks(user_id,provider,capability,credential_hash,status,checked_at) VALUES (?,'taobao',?,?,?,?) ON CONFLICT(user_id,provider,capability) DO UPDATE SET credential_hash=excluded.credential_hash,status=excluded.status,checked_at=excluded.checked_at")
    .run(userId, capability, hash, status, new Date().toISOString());
}
function requireProvider(provider: ShoppingProvider) {
  if (provider !== "taobao") throw new ShoppingApiError("美团待取得官方签名 SDK 并核验供给权限，目前请使用已验证的手动入口。", 503, "pending_official_sdk");
  if (!taobaoConfig().configured) throw new ShoppingApiError("淘宝闪购联盟凭证未配置，请参考 .env.example 配置后重启服务。", 503, "unconfigured");
}
function coordinate(value: unknown, max: number): string {
  if (typeof value !== "string" || !/^-?\d{1,3}(\.\d{1,6})?$/.test(value) || Math.abs(Number(value)) > max) throw new ShoppingApiError("请填写有效的 GCJ-02 经纬度，最多 6 位小数。", 422, "invalid_input");
  return String(Number(value));
}
export function validateOfficialLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new ShoppingApiError("平台未返回可用的购买链接。");
  let url: URL; try { url = new URL(value); } catch { throw new ShoppingApiError("平台未返回可用的购买链接。"); }
  const hosts = ["taobao.com", "ele.me", "tmall.com"];
  const allowed = hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) || url.hostname === "m.duanqu.com";
  if (url.protocol !== "https:" || !allowed || url.username || url.password || (url.port && url.port !== "443")) throw new ShoppingApiError("平台返回的链接域名尚未支持，请使用手动入口。");
  return url.href;
}
function assertSameCredentials(hash: string) {
  if (hash !== fingerprint()) throw new ShoppingApiError("平台账号配置已改变，请重新查询。", 409, "credentials_changed");
}
export async function searchShoppingStores(userId: string, provider: ShoppingProvider, input: JsonObject) {
  requireProvider(provider);
  if (input.locationConsent !== true) throw new ShoppingApiError("查询附近门店需要你确认向淘宝闪购发送本次经纬度。", 422, "invalid_input");
  const longitude = coordinate(input.longitude, 180), latitude = coordinate(input.latitude, 90);
  if (typeof input.keyword !== "string" || !input.keyword.trim() || input.keyword.trim().length > 100) throw new ShoppingApiError("请输入 1–100 字的门店名称关键词。", 422, "invalid_input");
  const hash = fingerprint();
  try {
    const data = await callTaobao("query", {longitude, latitude, search_content: input.keyword.trim(), page_size: 20, include_dynamic: true, sort_type: "distance"});
    assertSameCredentials(hash);
    const records = Array.isArray(data.records) ? data.records : object(data.records).store_promotion_dto;
    if (!Array.isArray(records)) throw new ShoppingApiError("平台门店列表格式异常。");
    const now = new Date().toISOString(), expiresAt = new Date(Date.now() + RESULT_TTL).toISOString();
    const candidates = records.slice(0, 20).map(value => {
      const row = object(value), shopId = string(row.shop_id, 500), title = string(row.title);
      if (!shopId || !title) return null;
      const recommended = Array.isArray(row.items) ? row.items : row.items && typeof row.items === "object" ? (row.items as JsonObject).promotion_item : [];
      const candidate = {id: randomUUID(), title, kind: "store", provider: "taobao", category: string(row.category_1_name),
        deliveryFeeCents: price(row.delivery_fee), minimumOrderCents: price(row.delivery_price),
        deliveryMinutes: typeof row.delivery_time === "number" ? row.delivery_time : null,
        items: Array.isArray(recommended) ? recommended.slice(0, 5).map(i => {const item = object(i); return {title: string(item.title), priceCents: price(item.price), specification: "待核对"};}) : [],
        source: "淘宝闪购联盟", fetchedAt: now, expiresAt, review: "门店结果不代表食材匹配，价格、规格、库存和配送范围以平台结算页为准。"};
      return {candidate, shopId};
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    const db = getDatabase();
    db.transaction(() => {
      db.prepare("DELETE FROM shopping_candidates WHERE expires_at<=? OR (user_id=? AND credential_hash<>?)").run(now, userId, hash);
      for (const row of candidates) db.prepare("INSERT INTO shopping_candidates(user_id,id,provider,credential_hash,payload_json,expires_at) VALUES (?,?,'taobao',?,?,?)")
        .run(userId, row.candidate.id, hash, JSON.stringify(row), expiresAt);
      db.prepare("DELETE FROM shopping_candidates WHERE user_id=? AND id NOT IN (SELECT id FROM shopping_candidates WHERE user_id=? ORDER BY expires_at DESC, rowid DESC LIMIT 100)").run(userId, userId);
      check(userId, hash, "storeSearch", "verified");
    })();
    return {candidates: candidates.map(row => row.candidate), fetchedAt: now, expiresAt, scope: "附近门店名称搜索", queryVerified: true};
  } catch (error) { check(userId, hash, "storeSearch", "failed"); throw error; }
}
export async function getShoppingPurchaseLink(userId: string, provider: ShoppingProvider, candidateId: unknown) {
  requireProvider(provider);
  if (typeof candidateId !== "string" || candidateId.length > 100) throw new ShoppingApiError("候选门店无效。", 422);
  const hash = fingerprint();
  const row = getDatabase().prepare("SELECT payload_json,expires_at FROM shopping_candidates WHERE user_id=? AND provider=? AND id=? AND credential_hash=?")
    .get(userId, provider, candidateId, hash) as {payload_json: string; expires_at: string} | undefined;
  if (!row) throw new ShoppingApiError("找不到本用户的门店结果，请重新查询。", 404);
  if (Date.parse(row.expires_at) <= Date.now()) throw new ShoppingApiError("门店结果已过期，请重新查询。", 409);
  const cached = JSON.parse(row.payload_json) as {candidate: {title: string}; shopId: string; link?: {url: string; fetchedAt: string; expiresAt: string; statusSource: string}};
  if (cached.link && Date.parse(cached.link.expiresAt) > Date.now()) return cached.link;
  try {
    const data = await callTaobao("get", {shop_id: cached.shopId});
    assertSameCredentials(hash);
    if (Date.parse(row.expires_at) <= Date.now()) throw new ShoppingApiError("门店结果已过期，请重新查询。", 409);
    const links = object(data.link);
    let url = "";
    for (const value of [links.h5_url, links.taobao_scheme_url]) { try { url = validateOfficialLink(value); break; } catch { /* Try the other documented URL. */ } }
    if (!url) throw new ShoppingApiError("平台未返回已支持的 HTTPS 购买链接，可继续使用手动入口。");
    const link = {url, fetchedAt: new Date().toISOString(), expiresAt: new Date(Math.min(Date.now() + LINK_TTL, Date.parse(row.expires_at))).toISOString(), statusSource: "official_api"};
    getDatabase().prepare("UPDATE shopping_candidates SET payload_json=? WHERE user_id=? AND id=? AND credential_hash=?").run(JSON.stringify({...cached, link}), userId, candidateId, hash);
    check(userId, hash, "purchaseLink", "verified");
    return link;
  } catch (error) { check(userId, hash, "purchaseLink", "failed"); throw error; }
}
