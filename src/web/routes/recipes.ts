/**
 * P5 用户菜谱路由（注册顺序在 weeklyPlan 之前，先于其 /api/recipes/:id 兜底）：
 *  - POST /api/recipes/import/preview  粘贴文本 → LLM 抽取 + 三项检查（无写入）
 *  - POST /api/recipes/import          入库（writeOnce 栅栏；遗漏项必须已处理）
 *  - GET  /api/recipes/mine            我的菜谱列表
 *  - DELETE /api/recipes/mine/:id      删除自己的菜谱（writeOnce 栅栏 + RAG 索引清理）
 *
 * 安全模型：draft 由服务端白名单重建（未知字段与 allergenTags/ingredientIds
 * 一律丢弃），过敏原标签永远从食材面按分类表派生；遗漏项未处理完不入库。
 */
import type { RouteContext } from "../context.js";
import { readJson, sendJson, sendWriteError } from "../helpers/http.js";
import {
  duplicateCheck,
  omissionCheck,
  provenanceCheck,
  unmappedCheck,
} from "../../import/userRecipe/checks.js";
import {
  RecipeExtractionError,
  extractRecipeFromText,
  sanitizeExistingDraft,
} from "../../import/userRecipe/extractRecipe.js";
import {
  OmissionUnresolvedError,
  saveUserRecipe,
} from "../../import/userRecipe/saveRecipe.js";
import { deleteRecipeIndexEntries, indexRecipeIncrementally } from "../../rag/index.js";
import * as store from "../../store/index.js";

const PREVIEW_TEXT_MAX = 20000;
const PREVIEW_TEXT_MIN = 30;

function parseStringArray(value: unknown, maxItems: number): string[] {
  return (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []).slice(0, maxItems);
}

export async function handleRecipeImportRoutes(ctx: RouteContext): Promise<boolean> {
  const { request, response, url } = ctx;

  if (request.method === "POST" && url.pathname === "/api/recipes/import/preview") {
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request, 256 * 1024);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "请求体无效。" });
      return true;
    }
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (text.length < PREVIEW_TEXT_MIN) {
      sendJson(response, 400, { error: `菜谱文本太短（至少 ${PREVIEW_TEXT_MIN} 字）。` });
      return true;
    }
    if (text.length > PREVIEW_TEXT_MAX) {
      sendJson(response, 400, { error: `菜谱文本不能超过 ${PREVIEW_TEXT_MAX} 字。` });
      return true;
    }
    try {
      const draft = await extractRecipeFromText(text);
      const ownAndGlobal = store.getRecipeBookForUser(ctx.userId);
      const preview = {
        draft,
        untraceable: provenanceCheck(draft, text),
        omissions: omissionCheck(draft, text),
        duplicates: duplicateCheck(draft, ownAndGlobal),
        unmapped: unmappedCheck(draft),
        warnings: [] as string[],
      };
      if (preview.unmapped.length > 0) {
        preview.warnings.push(`以下食材不在分类表中，无法核对过敏原：${preview.unmapped.join("、")}。有忌口/过敏的推荐路径会把这道菜标记为待确认（失败即关闭）。`);
      }
      sendJson(response, 200, preview);
    } catch (error) {
      if (error instanceof RecipeExtractionError) {
        sendJson(response, 422, { error: error.message });
        return true;
      }
      console.error("[recipes/preview]", error instanceof Error ? error.name : typeof error);
      sendJson(response, 502, { error: "菜谱抽取失败：导入模型未配置或暂时不可用，请稍后重试。" });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/recipes/import") {
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request, 256 * 1024);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "请求体无效。" });
      return true;
    }
    const allowed = new Set(["operationId", "draft", "text", "dismissedOmissionIds"]);
    if (Object.keys(payload).some((key) => !allowed.has(key))) {
      sendJson(response, 400, { error: "导入请求包含不支持的字段。" });
      return true;
    }
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text || text.length > PREVIEW_TEXT_MAX) {
      sendJson(response, 400, { error: "缺少原文或原文过长（保存时需要原文做遗漏复核）。" });
      return true;
    }
    if (!payload.draft || typeof payload.draft !== "object" || Array.isArray(payload.draft)) {
      sendJson(response, 400, { error: "菜谱草稿无效。" });
      return true;
    }
    const dismissedOmissionIds = parseStringArray(payload.dismissedOmissionIds, 200);
    try {
      // 白名单重建：丢弃客户端送来的任何派生字段（allergenTags/ingredientIds/id）
      const draft = sanitizeExistingDraft(payload.draft as Record<string, unknown>);
      const result = ctx.executeWebWriteOnce("/api/recipes/import", { ...payload, draft, text, dismissedOmissionIds }, () => {
        const saved = saveUserRecipe(ctx.userId, draft, text, dismissedOmissionIds);
        void indexRecipeIncrementally(saved); // best-effort 增量索引，不阻塞响应
        return {
          saved: true as const,
          recipe: {
            id: saved.id,
            name: saved.name,
            allergenTags: saved.allergenTags,
            ingredientCount: saved.ingredients.length + (saved.optionalIngredients?.length ?? 0),
            updatedAt: saved.updatedAt,
          },
        };
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof OmissionUnresolvedError) {
        sendJson(response, 409, { error: error.message, unresolved: error.unresolved });
        return true;
      }
      sendWriteError(response, error, "菜谱保存失败。");
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/recipes/mine") {
    const recipes = store.getUserRecipes(ctx.userId).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      allergenTags: recipe.allergenTags,
      ingredientCount: recipe.ingredients.length + (recipe.optionalIngredients?.length ?? 0),
      activeMinutes: recipe.activeMinutes,
      totalMinutes: recipe.totalMinutes,
      updatedAt: recipe.updatedAt,
    }));
    sendJson(response, 200, { recipes });
    return true;
  }

  const mineDeleteMatch = /^\/api\/recipes\/mine\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && mineDeleteMatch) {
    const recipeId = decodeURIComponent(mineDeleteMatch[1]!);
    let payload: Record<string, unknown>;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "请求体无效。" });
      return true;
    }
    try {
      const result = ctx.executeWebWriteOnce(`/api/recipes/mine/${recipeId}`, { ...payload, recipeId }, () => {
        const deleted = store.deleteUserRecipe(ctx.userId, recipeId);
        if (!deleted) throw new Error("没有找到这道菜谱（可能已删除）。");
        deleteRecipeIndexEntries([recipeId]);
        return { deleted: true as const, id: recipeId };
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendWriteError(response, error, "删除失败。");
    }
    return true;
  }

  return false;
}
