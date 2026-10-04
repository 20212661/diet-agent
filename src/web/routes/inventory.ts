import type { RouteContext } from "../context.js";
import * as store from "../../store/index.js";
import { todayDate } from "../../store/shared.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import { ingredientList, parseInventoryItem } from "../payloadValidation.js";
import { saveInventory } from "../profileWrites.js";
import { parseReceiptImage, receiptImage } from "../receiptParser.js";

export async function handleInventoryRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "POST" && url.pathname === "/api/inventory") {
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () => {
        saveInventory(ctx.userId, payload);
        return { saved: true };
      });
      sendJson(response, 200, { ...result, data: ctx.getDashboardData() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败。";
      sendWriteError(response, error, message);
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/inventory/items") {
    try {
      const payload = await readJson(request);
      const item = parseInventoryItem(payload, true);
      const result = await ctx.executeWebWriteOnce(url.pathname, payload, () => {
        const saved = store.addIngredientInventoryItem(ctx.userId, item);
        return { saved: true, item: saved.item, inventory: saved.inventory, updatedAt: saved.inventory.updatedAt };
      });
      sendJson(response, 201, result);
    } catch (error) {
      sendWriteError(response, error, "添加食材失败。");
    }
    return true;
  }

  const inventoryItemMatch = /^\/api\/inventory\/items\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PATCH" && inventoryItemMatch) {
    try {
      const itemId = decodeURIComponent(inventoryItemMatch[1]!);
      const payload = await readJson(request);
      if (typeof payload.updatedAt !== "string" || !payload.updatedAt) throw new Error("缺少读取库存时的 updatedAt，请刷新后重试。");
      const patch = parseInventoryItem(payload, false);
      const operation = await ctx.executeWebWriteOnce(url.pathname, payload, () =>
        store.updateIngredientInventoryItem(ctx.userId, itemId, payload.updatedAt as string, patch));
      if (operation.status === "conflict") {
        sendJson(response, 409, { error: "库存已被其他操作修改，请刷新后再编辑。", inventory: operation.inventory, updatedAt: operation.inventory.updatedAt });
      } else if (operation.status === "not_found") {
        sendJson(response, 404, { error: "找不到这项食材，请刷新库存。", inventory: operation.inventory, updatedAt: operation.inventory.updatedAt });
      } else {
        sendJson(response, 200, { saved: true, item: operation.item, inventory: operation.inventory, updatedAt: operation.inventory.updatedAt });
      }
    } catch (error) {
      sendWriteError(response, error, "修改食材失败。");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/inventory/import") {
    try {
      const payload = await readJson(request);
      const ingredients = ingredientList(payload.items, "导入食材");
      if (!ingredients.length) throw new Error("请选择至少一项食材。");
      const result = await ctx.executeWebWriteOnce("/api/inventory/import", payload, () => {
        const savedInventory = store.upsertIngredientInventory(ctx.userId, {
          availableIngredients: ingredients.map((item) => ({ ...item, status: "available" as const, purchasedAt: item.purchasedAt ?? todayDate() })),
        });
        return { saved: true, count: ingredients.length, inventory: savedInventory };
      });
      sendJson(response, 200, { ...result, data: ctx.getDashboardData() });
    } catch (error) {
      sendWriteError(response, error, "导入失败。");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/receipt/parse") {
    try {
      const payload = await readJson(request, 6_200_000);
      const image = receiptImage(payload);
      const extracted = await parseReceiptImage(image);
      sendJson(response, 200, { items: extracted });
    } catch (error) {
      console.error("[WEB receipt parse]", error instanceof Error ? error.name : typeof error);
      sendJson(response, 400, { error: error instanceof Error ? error.message : "清单识别失败。" });
    }
    return true;
  }

  return false;
}
