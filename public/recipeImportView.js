/**
 * 我的菜谱（P5 用户自助导入）视图控制器。
 *
 * 流程：粘贴原文 → /api/recipes/import/preview（LLM 抽取 + 溯源/遗漏/查重检查）
 * → 预览卡片上处理红色遗漏项（补进食材或忽略）与黄色溯源项（删或留）
 * → /api/recipes/import 入库（服务端复核遗漏项，未处理完返回 409）。
 * 事件全部委托在 root 上，一次绑定；状态（preview/dismissed）存在闭包里，
 * 页面切换重渲染不丢。
 */

export function createRecipeImportController({ root, getData, getPendingWrite, toast, refreshData }) {
  const state = {
    preview: null,
    rawText: "",
    /** 已处理（补进食材或忽略）的遗漏项 definitionId */
    resolvedOmissionIds: new Set(),
    /** 用户选择删除的无法溯源食材（field|name） */
    removedUntraceable: new Set(),
    /** 用户已确认保留的无法溯源食材（field|name，仅用于从待办列表隐藏） */
    acknowledgedUntraceable: new Set(),
    mine: null,
    loadingPreview: false,
  };

  const $ = (selector) => root.querySelector(selector);

  function allergenLabel(finding) {
    const tags = [...finding.allergens, ...finding.possibleAllergens.map((a) => `可能含 ${a}`)];
    return tags.length ? tags.join("、") : "无已知过敏原";
  }

  function draftFromDom() {
    const preview = state.preview;
    if (!preview) return null;
    const lines = (id) => ($(id)?.value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const untraceableKeys = state.removedUntraceable;
    const isRemoved = (field, name) => untraceableKeys.has(`${field}|${name}`);
    const filterFace = (field, names) => names.filter((name) => !isRemoved(field, name));
    const num = (id, fallback) => {
      const value = Number($(id)?.value);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
      ...preview.draft,
      name: ($("#ri-name")?.value ?? preview.draft.name).trim(),
      ingredients: filterFace("ingredients", lines("ri-ingredients")),
      optionalIngredients: filterFace("optionalIngredients", lines("ri-optional")),
      vegetables: filterFace("vegetables", lines("ri-vegetables")),
      staples: filterFace("staples", lines("ri-staples")),
      primaryProtein: isRemoved("primaryProtein", preview.draft.primaryProtein ?? "") ? undefined : preview.draft.primaryProtein,
      steps: lines("ri-steps"),
      activeMinutes: num("ri-active", preview.draft.activeMinutes),
      totalMinutes: num("ri-total", preview.draft.totalMinutes),
    };
  }

  function unresolvedOmissions() {
    if (!state.preview) return [];
    return state.preview.omissions.filter((finding) => !state.resolvedOmissionIds.has(finding.definitionId));
  }


  function renderPastePanel() {
    return `
      <div class="page-intro"><div class="eyebrow">IMPORT A RECIPE</div><h1>把菜谱变成你的</h1>
        <p>粘贴一份菜谱文本（网页复制的做法、家里传下来的方子、随手记的笔记都行）。助手会抽取食材和步骤，核对过敏原，你确认后存成自己的菜谱——只对你可见，搜索和推荐会用到它。</p></div>
      <form class="editor-form" data-recipe-import-form>
        <div class="field field-wide"><label for="ri-text">菜谱原文</label>
          <textarea id="ri-text" rows="9" placeholder="粘贴菜谱原文：菜名、用料、步骤……">${esc(state.rawText)}</textarea></div>
        <div class="form-actions"><span>原文只用于抽取与核对，保存后不再上传；入库前会逐项核对过敏原。</span>
          <button type="submit" class="primary-button" ${state.loadingPreview ? "disabled" : ""}>${state.loadingPreview ? "正在解析…" : "解析预览"}</button></div>
      </form>`;
  }

  function renderFindings() {
    const preview = state.preview;
    const unresolved = unresolvedOmissions();
    const sections = [];

    if (unresolved.length > 0) {
      const rows = unresolved.map((finding, index) => `
        <div class="import-finding finding-red">
          <div class="finding-main"><strong>${esc(finding.alias)}</strong><small>原文：…${esc(finding.snippet)}…</small>
            <span class="finding-tags">${esc(allergenLabel(finding))}</span></div>
          <div class="finding-actions">
            <button type="button" class="text-button" data-omission-add="${esc(finding.definitionId)}" data-omission-alias="${esc(finding.alias)}">加入食材</button>
            <button type="button" class="text-button" data-omission-dismiss="${esc(finding.definitionId)}">原文与此菜无关</button>
          </div>
        </div>`).join("");
      sections.push(`<div class="import-section"><h3>原文有、抽取没有（处理完才能保存）</h3>${rows}
        <button type="button" class="text-button" data-omission-dismiss-clean>忽略全部无过敏原项</button></div>`);
    }

    const keptUntraceable = preview.untraceable.filter((item) =>
      !state.removedUntraceable.has(`${item.field}|${item.ingredient}`)
      && !state.acknowledgedUntraceable.has(`${item.field}|${item.ingredient}`));
    if (keptUntraceable.length > 0) {
      const rows = keptUntraceable.map((item) => `
        <div class="import-finding finding-warn">
          <div class="finding-main"><strong>${esc(item.ingredient)}</strong><small>在原文里找不到这个名字（或它的分类表别名）——可能是误抽，也可能是原文的变体写法。</small></div>
          <div class="finding-actions">
            <button type="button" class="text-button" data-untraceable-remove="${esc(item.field)}|${esc(item.ingredient)}">删除</button>
            <button type="button" class="text-button" data-untraceable-keep="${esc(item.field)}|${esc(item.ingredient)}">保留</button>
          </div>
        </div>`).join("");
      sections.push(`<div class="import-section"><h3>无法溯源的食材（删或留，由你定）</h3>${rows}</div>`);
    }

    if (preview.duplicates.length > 0) {
      const rows = preview.duplicates.map((dup) => `
        <div class="import-finding"><div class="finding-main"><strong>与《${esc(dup.existingName)}》${dup.kind === "name" ? "同名" : `食材高度相似（${Math.round((dup.jaccard ?? 0) * 100)}%）`}</strong>
          <small>仍可保存为你自己的版本，两道菜都会出现在你的搜索里。</small></div></div>`).join("");
      sections.push(`<div class="import-section"><h3>重复提示</h3>${rows}</div>`);
    }

    if (preview.warnings.length > 0) {
      sections.push(`<div class="import-section"><h3>注意</h3>${preview.warnings.map((warning) => `<p class="support-copy">${esc(warning)}</p>`).join("")}</div>`);
    }
    return sections.join("");
  }

  function renderPreviewPanel() {
    const draft = state.preview.draft;
    const resolvedCount = state.preview.omissions.length - unresolvedOmissions().length;
    return `
      <div class="page-intro"><div class="eyebrow">REVIEW &amp; CONFIRM</div><h1>${esc(draft.name)}</h1>
        <p>共抽取 ${draft.ingredients.length} 项必用食材、${draft.steps.length} 个步骤。红色项处理完才能保存； allergenTags 由系统按分类表从食材面派生，不受原文或模型影响。</p></div>
      <form class="editor-form" data-recipe-import-form>
        <div class="form-grid">
          <div class="field field-wide"><label for="ri-name">菜名</label><input id="ri-name" value="${esc(draft.name)}" maxlength="60" /></div>
          <div class="field"><label for="ri-active">主动操作（分钟）</label><input id="ri-active" type="number" min="1" max="120" value="${draft.activeMinutes}" /></div>
          <div class="field"><label for="ri-total">总耗时（分钟）</label><input id="ri-total" type="number" min="1" max="240" value="${draft.totalMinutes}" /></div>
          <div class="field field-wide"><label for="ri-ingredients">必用食材（每行一项）</label><textarea id="ri-ingredients" rows="5">${esc(draft.ingredients.join("\n"))}</textarea></div>
          <div class="field field-wide"><label for="ri-optional">可选食材（每行一项）</label><textarea id="ri-optional" rows="2">${esc((draft.optionalIngredients ?? []).join("\n"))}</textarea></div>
          <div class="field"><label for="ri-vegetables">蔬菜（每行一项）</label><textarea id="ri-vegetables" rows="2">${esc((draft.vegetables ?? []).join("\n"))}</textarea></div>
          <div class="field"><label for="ri-staples">主食（每行一项）</label><textarea id="ri-staples" rows="2">${esc((draft.staples ?? []).join("\n"))}</textarea></div>
          <div class="field field-wide"><label for="ri-steps">步骤（每行一步）</label><textarea id="ri-steps" rows="8">${esc(draft.steps.join("\n"))}</textarea></div>
        </div>
        ${renderFindings()}
        <div class="form-actions">
          <span>遗漏项 ${resolvedCount}/${state.preview.omissions.length} 已处理${unresolvedOmissions().length > 0 ? "——处理完才能保存" : ""}</span>
          <div class="receipt-actions">
            <button type="button" class="secondary-button" data-recipe-reset>重新粘贴</button>
            <button type="submit" class="primary-button" ${unresolvedOmissions().length > 0 ? "disabled" : ""}>保存为我的菜谱</button>
          </div>
        </div>
      </form>`;
  }

  function renderMinePanel() {
    if (!state.mine) return `<div class="skeleton"></div>`;
    if (state.mine.recipes.length === 0) {
      return `<div class="import-section"><h3>我导入的菜谱</h3><p class="support-copy">还没有导入过菜谱。上面粘贴一份试试。</p></div>`;
    }
    const rows = state.mine.recipes.map((recipe) => {
      const warningBars = (recipe.resurfacedWarnings ?? []).map((warning) => `
        <div class="import-finding warning">
          <div class="finding-main"><strong>⚠️ ${esc(warning.message)}</strong>
            <small>推荐时这道菜会先被拦下，直到涉及的成员都确认"与菜无关"。</small></div>
          <div class="finding-actions">${warning.affectedMembers.map((member) => `<button type="button" class="text-button" data-warning-confirm="${esc(recipe.id)}" data-warning-definition="${esc(warning.definitionId)}" data-warning-member="${esc(member.memberId)}" data-warning-name="${esc(member.name)}">已为${esc(member.name)}确认</button>`).join("")}</div>
        </div>`).join("");
      return `
      <div class="import-finding"><div class="finding-main"><strong>${esc(recipe.name)}</strong>
        <small>${recipe.ingredientCount} 项食材 · 主动 ${recipe.activeMinutes} 分钟 / 总计 ${recipe.totalMinutes} 分钟 · 过敏原：${recipe.allergenTags.length ? esc(recipe.allergenTags.join("、")) : "无已知"}</small></div>
        <div class="finding-actions"><button type="button" class="text-button" data-recipe-delete="${esc(recipe.id)}">删除</button></div>
      </div>${warningBars}`;
    }).join("");
    return `<div class="import-section"><h3>我导入的菜谱（${state.mine.recipes.length}）</h3>${rows}</div>`;
  }

  function render() {
    if (!getData()) return `<div class="skeleton"></div>`;
    return `
      ${state.preview ? renderPreviewPanel() : renderPastePanel()}
      ${renderMinePanel()}`;
  }

  async function loadMine() {
    try {
      const response = await fetch("/api/recipes/mine", { cache: "no-store" });
      if (!response.ok) throw new Error("读取失败");
      state.mine = await response.json();
    } catch {
      state.mine = { recipes: [] };
    }
  }

  function rerender() {
    if (typeof root.replaceChildren !== "function") return;
    // 保守重渲染：直接重画整个面板（与 app.js renderPage 相同容器）
    const holder = document.createElement("div");
    holder.innerHTML = render();
    root.replaceChildren(...holder.childNodes);
  }

  async function requestPreview() {
    const text = ($("#ri-text")?.value ?? "").trim();
    if (text.length < 30) { toast("菜谱文本太短（至少 30 字）。"); return; }
    state.loadingPreview = true;
    const button = root.querySelector("[data-recipe-import-form] button[type=submit]");
    if (button) { button.disabled = true; button.textContent = "正在解析…"; }
    try {
      const response = await fetch("/api/recipes/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(getData().userId) },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "解析失败。");
      state.preview = result;
      state.rawText = text;
      state.resolvedOmissionIds = new Set();
      state.removedUntraceable = new Set();
    } catch (error) {
      toast(error instanceof Error ? error.message : "解析失败，请重试。");
    } finally {
      state.loadingPreview = false;
      rerender();
    }
  }

  async function requestSave() {
    const draft = draftFromDom();
    if (!draft) return;
    const payload = {
      draft,
      text: state.rawText,
      dismissedOmissionIds: [...state.resolvedOmissionIds],
    };
    const endpoint = "/api/recipes/import";
    const pending = getPendingWrite(endpoint, payload);
    const button = root.querySelector("[data-recipe-import-form] button[type=submit]");
    if (button) { button.disabled = true; button.textContent = "正在保存…"; }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) },
        body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }),
      });
      const result = await response.json();
      if (response.status === 409 && result.unresolved) {
        // 用户在预览后又改了食材 → 服务器复核出新的未处理遗漏项，回到预览展示
        for (const finding of result.unresolved) state.resolvedOmissionIds.delete(finding.definitionId);
        state.preview = { ...state.preview, omissions: [...state.preview.omissions, ...result.unresolved.filter((f) => !state.preview.omissions.some((o) => o.definitionId === f.definitionId))] };
        toast("食材改动后又出现了待处理项，请查看红色标注。");
        rerender();
        return;
      }
      if (!response.ok) throw new Error(result.error || "保存失败。");
      localStorage.removeItem(pending.key);
      toast(`《${result.recipe.name}》已保存为你的菜谱。`);
      state.preview = null;
      state.rawText = "";
      await loadMine();
      await refreshData();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败，请重试。");
      rerender();
    }
  }

  async function requestDelete(recipeId) {
    if (!window.confirm("确认删除这道菜谱？删除后搜索和推荐不再使用它。")) return;
    const endpoint = `/api/recipes/mine/${encodeURIComponent(recipeId)}`;
    const pending = getPendingWrite(endpoint, { recipeId });
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) },
        body: JSON.stringify({ operationId: pending.operationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "删除失败。");
      localStorage.removeItem(pending.key);
      toast("菜谱已删除。");
      await loadMine();
      rerender();
    } catch (error) {
      toast(error instanceof Error ? error.message : "删除失败。");
    }
  }

  async function requestWarningConfirm(recipeId, definitionId, memberId, memberName) {
    if (!window.confirm(`确认"${memberName}"与这道菜无关？确认后为${memberName}排菜时不再因这条警告拦下它。`)) return;
    const endpoint = `/api/recipes/mine/${encodeURIComponent(recipeId)}/warning-confirm`;
    const pending = getPendingWrite(endpoint, { definitionId, memberId });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) },
        body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "确认失败。");
      localStorage.removeItem(pending.key);
      toast(`已为${memberName}确认。`);
      await loadMine();
      rerender();
    } catch (error) {
      toast(error instanceof Error ? error.message : "确认失败，请重试。");
    }
  }

  function addOmissionIngredient(definitionId, alias) {
    const textarea = $("#ri-ingredients");
    if (textarea) {
      textarea.value = textarea.value ? `${textarea.value.replace(/\s+$/, "")}\n${alias}` : alias;
    }
    state.resolvedOmissionIds.add(definitionId);
    rerender();
  }

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-recipe-import-form]");
    if (!form) return;
    event.preventDefault();
    if (state.preview) requestSave();
    else requestPreview();
  });

  root.addEventListener("click", (event) => {
    const addTarget = event.target.closest("[data-omission-add]");
    if (addTarget) { addOmissionIngredient(addTarget.dataset.omissionAdd, addTarget.dataset.omissionAlias); return; }
    const dismissTarget = event.target.closest("[data-omission-dismiss]");
    if (dismissTarget) { state.resolvedOmissionIds.add(dismissTarget.dataset.omissionDismiss); rerender(); return; }
    if (event.target.closest("[data-omission-dismiss-clean]")) {
      for (const finding of state.preview?.omissions ?? []) {
        if (finding.allergens.length === 0 && finding.possibleAllergens.length === 0) {
          state.resolvedOmissionIds.add(finding.definitionId);
        }
      }
      rerender();
      return;
    }
    const removeTarget = event.target.closest("[data-untraceable-remove]");
    if (removeTarget) { state.removedUntraceable.add(removeTarget.dataset.untraceableRemove); rerender(); return; }
    const keepTarget = event.target.closest("[data-untraceable-keep]");
    if (keepTarget) { state.acknowledgedUntraceable.add(keepTarget.dataset.untraceableKeep); rerender(); return; }
    if (event.target.closest("[data-recipe-reset]")) {
      state.preview = null;
      state.rawText = "";
      state.resolvedOmissionIds = new Set();
      state.removedUntraceable = new Set();
      rerender();
      return;
    }
    const deleteTarget = event.target.closest("[data-recipe-delete]");
    if (deleteTarget) { requestDelete(deleteTarget.dataset.recipeDelete); return; }
    const confirmTarget = event.target.closest("[data-warning-confirm]");
    if (confirmTarget) {
      requestWarningConfirm(confirmTarget.dataset.warningConfirm, confirmTarget.dataset.warningDefinition, confirmTarget.dataset.warningMember, confirmTarget.dataset.warningName);
      return;
    }
  });

  return { render, loadMine };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
