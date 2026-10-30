import type { ShoppingProvider } from "./types.js";
import { getDatabase } from "../store/database.js";
import { officialApiStatus } from "./discovery.js";

export function providerId(value: unknown): ShoppingProvider {
  if (value !== "meituan" && value !== "taobao") throw new Error("购物平台无效。");
  return value;
}
export function validateEntryUrl(provider: ShoppingProvider, value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new Error("平台链接最多 2000 个字符。");
  const url = new URL(value);
  const domains = provider === "meituan" ? ["meituan.com"] : ["taobao.com", "ele.me", "tb.ele.me"];
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error("请使用该平台官方域名的 HTTPS 链接，不支持本机地址或未验证的短链域名。");
  }
  return url.href;
}
export function getShoppingProviders(userId: string) {
  return (["meituan", "taobao"] as const).map(id => {
    const row = getDatabase().prepare("SELECT url, verified_at FROM shopping_provider_settings WHERE user_id = ? AND provider = ?").get(userId, id) as {url: string; verified_at: string} | undefined;
    const officialApi = officialApiStatus(userId, id);
    return { id, label: id === "meituan" ? "美团" : "淘宝闪购", entryUrl: row?.url ?? "", verifiedAt: row?.verified_at ?? null, officialApi,
      status: row ? "user_verified" : "unconfigured", capabilities: { entryLink: Boolean(row), storeSearch: officialApi.storeSearch, purchaseLink: officialApi.purchaseLink, productSearch: false, cartWrite: false, orderCreate: false, orderStatus: false } };
  });
}
export function saveShoppingProvider(userId: string, provider: ShoppingProvider, url: unknown, verified: unknown) {
  const db = getDatabase();
  if (url === "") { db.prepare("DELETE FROM shopping_provider_settings WHERE user_id = ? AND provider = ?").run(userId, provider); return; }
  if (verified !== true) throw new Error("请先在你的设备上打开链接，确认是可用的购物入口。");
  const safeUrl = validateEntryUrl(provider, url);
  db.prepare("INSERT INTO shopping_provider_settings (user_id, provider, url, verified_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET url=excluded.url, verified_at=excluded.verified_at")
    .run(userId, provider, safeUrl, new Date().toISOString());
}
