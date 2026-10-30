import QRCode from "qrcode";
import type { RouteContext } from "../context.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import { parseReceiptImage, receiptImage } from "../receiptParser.js";
import { getShoppingProviders, providerId, saveShoppingProvider } from "../../shopping/providers.js";
import { searchShoppingStores, getShoppingPurchaseLink } from "../../shopping/discovery.js";
import { ShoppingApiError } from "../../shopping/taobaoClient.js";
import { createCartExperiment, getCartExperiment, listCartExperiments, changeCartExperiment } from "../../shopping/cartExperiment.js";
import { createShoppingTask, listShoppingTasks, getShoppingTask, changeShoppingItems, editShoppingItem, receiveShoppingItems, shoppingHandoff, ShoppingError } from "../../shopping/shoppingService.js";

export async function handleShoppingRoutes(ctx: RouteContext): Promise<boolean> {
  const {request, response, url, userId} = ctx;
  if (!url.pathname.startsWith("/api/shopping/")) return false;
  try {
    const experimentMatch = /^\/api\/shopping\/cart-experiments(?:\/([^/]+)(?:\/(baseline|select|prepare|begin-step|unknown|reconcile|cancel))?)?$/.exec(url.pathname);
    if (experimentMatch) {
      const id = experimentMatch[1] && decodeURIComponent(experimentMatch[1]), action = experimentMatch[2];
      if (request.method === "GET" && !action) {
        sendJson(response, 200, id ? {experiment:getCartExperiment(userId,id)} : {experiments:listCartExperiments(userId)}); return true;
      }
      if (request.method === "POST" && (!id || action)) {
        const payload = await readJson(request,64 * 1024);
        const experiment = ctx.executeWebWriteOnce(url.pathname,payload,() => id ? changeCartExperiment(userId,id,action!,payload) : createCartExperiment(userId,payload));
        sendJson(response,id ? 200 : 201,{experiment}); return true;
      }
      return false;
    }
    if (request.method === "GET" && url.pathname === "/api/shopping/providers") {
      sendJson(response, 200, {providers: getShoppingProviders(userId)}); return true;
    }
    const discovery = /^\/api\/shopping\/providers\/([^/]+)\/(search|purchase-link)$/.exec(url.pathname);
    if (discovery && request.method === "POST") {
      const provider = providerId(discovery[1]), payload = await readJson(request);
      // External queries are read-only and must stay outside synchronous write-once transactions.
      if (discovery[2] === "search") {
        sendJson(response, 200, await searchShoppingStores(userId, provider, payload));
      } else {
        const link = await getShoppingPurchaseLink(userId, provider, payload.candidateId);
        const qr = await QRCode.toDataURL(link.url, {width: 256, margin: 4});
        sendJson(response, 200, {...link, qr});
      }
      return true;
    }
    if (url.pathname === "/api/shopping/tasks") {
      if (request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 50), offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new ShoppingError("分页参数无效。");
        sendJson(response, 200, {tasks: listShoppingTasks(userId, limit, offset)}); return true;
      }
      if (request.method === "POST") {
        const payload = await readJson(request);
        const task = ctx.executeWebWriteOnce(url.pathname, payload, () => createShoppingTask(userId, payload));
        sendJson(response, 201, {task}); return true;
      }
    }
    const setting = /^\/api\/shopping\/provider-settings\/([^/]+)$/.exec(url.pathname);
    if (setting && request.method === "POST") {
      const payload = await readJson(request);
      const result = ctx.executeWebWriteOnce(url.pathname, payload, () => {
        saveShoppingProvider(userId, providerId(setting[1]), payload.url, payload.verified);
        return {providers: getShoppingProviders(userId)};
      });
      sendJson(response, 200, result); return true;
    }
    const match = /^\/api\/shopping\/tasks\/([^/]+)(?:\/(handoffs|mark-ordered|cancel-items|receive|receipt-preview|items)(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (!match) return false;
    const id = decodeURIComponent(match[1]), action = match[2];
    if (!action && request.method === "GET") { sendJson(response, 200, {task: getShoppingTask(userId, id)}); return true; }
    if (request.method !== "POST" && !(request.method === "PATCH" && action === "items")) return false;
    const payload = await readJson(request, action === "receipt-preview" ? 6_200_000 : 64 * 1024);
    if (action === "receipt-preview") {
      getShoppingTask(userId, id);
      sendJson(response, 200, {items: await parseReceiptImage(receiptImage(payload))}); return true;
    }
    if (action === "handoffs") {
      const handoff = ctx.executeWebWriteOnce(url.pathname, payload, () => shoppingHandoff(userId, id));
      const qr = await QRCode.toDataURL(handoff.url, {width: 256, margin: 4});
      sendJson(response, 200, {...handoff, qr}); return true;
    }
    const result = ctx.executeWebWriteOnce(url.pathname, payload, () => {
      if (action === "receive") return receiveShoppingItems(userId, id, payload);
      if (action === "mark-ordered" || action === "cancel-items") return {task: changeShoppingItems(userId, id, payload, action === "mark-ordered" ? "ordered" : "cancelled")};
      if (action === "items" && match[3]) return {task: editShoppingItem(userId, id, decodeURIComponent(match[3]), payload)};
      throw new ShoppingError("不支持的采购操作。", 404);
    });
    sendJson(response, 200, result); return true;
  } catch (error) {
    if (error instanceof ShoppingApiError) sendJson(response, error.status, {error: error.message, code: error.code});
    else if (error instanceof ShoppingError) sendJson(response, error.status, {error: error.message});
    else sendWriteError(response, error, "采购操作失败。");
    return true;
  }
}
