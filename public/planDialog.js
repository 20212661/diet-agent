export function createPlanDialog({ getData, esc, list, toast, getPendingWrite, refreshData, renderPage }) {
  const planDialog = document.createElement("dialog");
  planDialog.className = "plan-recipe-dialog";
  document.body.append(planDialog);
  let openedPlanDate = null;
  let openedPlanAlternatives = [];
  let requestVersion = 0;
  let openedPlanContext = null;
  const isCurrent = (context) => planDialog.open && context.version === requestVersion
    && getData()?.userId === context.userId;
  function invalidateDialog() {
    requestVersion += 1;
    openedPlanContext = null;
    openedPlanAlternatives = [];
  }
  planDialog.addEventListener("close", () => { if (!planDialog.open) invalidateDialog(); });
  planDialog.addEventListener("cancel", invalidateDialog);
  async function openPlanDay(date) {
    const data = getData();
    const plan = data?.weeklyPlan;
    const selected = list(plan?.days).find((item) => item.date === date);
    if (!selected) return;
    const context = { version: ++requestVersion, userId: data.userId,
      weekStartDate: plan.weekStartDate, updatedAt: plan.updatedAt,
      day: JSON.parse(JSON.stringify(selected)) };
    const day = context.day;
    openedPlanContext = null;
    openedPlanAlternatives = [];
    openedPlanDate = date;
    planDialog.innerHTML = `<div class="dialog-loading">正在读取菜谱…</div>`;
    if (!planDialog.open) planDialog.showModal();
    try {
      if (day.executionBlockedReason) {
        const alternativeResponse = await fetch(`/api/weekly-plan/${encodeURIComponent(context.weekStartDate)}/day/${encodeURIComponent(date)}/alternatives`);
        if (!alternativeResponse.ok) throw new Error("无法读取安全的替换候选，请刷新后重试。");
        const alternativeData = await alternativeResponse.json();
        if (!isCurrent(context)) return;
        openedPlanContext = context;
        openedPlanAlternatives = alternativeData.alternatives ?? [];
        renderBlockedPlanDialog(day);
        return;
      }
      const [mainResponse, altResponse, sideResponse] = await Promise.all([
        fetch(`/api/recipes/${encodeURIComponent(day.mainRecipe.id)}`),
        fetch(`/api/weekly-plan/${encodeURIComponent(context.weekStartDate)}/day/${encodeURIComponent(date)}/alternatives`),
        day.sideRecipe ? fetch(`/api/recipes/${encodeURIComponent(day.sideRecipe.id)}`) : Promise.resolve(null),
      ]);
      if (!mainResponse.ok || !altResponse.ok || (sideResponse && !sideResponse.ok)) throw new Error("无法读取菜谱详情，请刷新后重试。");
      const main = (await mainResponse.json()).recipe;
      const alternativeData = await altResponse.json();
      const side = sideResponse ? (await sideResponse.json()).recipe : null;
      if (!isCurrent(context)) return;
      openedPlanContext = context;
      openedPlanAlternatives = alternativeData.alternatives ?? [];
      renderPlanDayDialog(day, main, side, alternativeData);
    } catch (error) {
      if (!isCurrent(context)) return;
      planDialog.innerHTML = `<form method="dialog"><button class="dialog-close" aria-label="关闭">×</button></form><p>${esc(error instanceof Error ? error.message : "读取失败")}</p>`;
    }
  }
  function renderBlockedPlanDialog(day) {
    const alternatives = openedPlanAlternatives.length
      ? `<div class="plan-alternatives">${openedPlanAlternatives.map((item) => `<div class="plan-alternative"><span><strong>${esc(item.recipe.name)}</strong><small>主动 ${Number(item.recipe.activeMinutes)} 分钟 · 总计 ${Number(item.recipe.totalMinutes)} 分钟</small></span><button type="button" class="secondary-button" data-replace-recipe="${esc(item.recipe.id)}">换成这道</button></div>`).join("")}</div>`
      : `<p class="support-copy">当前条件下没有安全且设备可用的替换菜谱。请调整设备、食材或重新生成计划。</p>`;
    planDialog.innerHTML = `<div class="plan-dialog-head"><div><div class="eyebrow">${esc(day.date)} · 需要重新安排</div><h2>当前计划暂不可执行</h2></div><button type="button" class="dialog-close" data-close-plan-dialog aria-label="关闭">×</button></div><p class="support-copy">${esc(day.executionBlockedReason)}</p><section><h3>当前安全候选</h3>${alternatives}</section>`;
  }
  function renderPlanDayDialog(day, main, side, alternativeData = {}) {
    const recipes = [main, side].filter(Boolean);
    const equipmentLabels = { stove: "炉灶", oven: "烤箱", microwave: "微波炉", rice_cooker: "电饭煲" };
    const readiness = list(day.ingredientReadiness);
    const ingredients = [...new Set(recipes.flatMap((recipe) => list(recipe.ingredients)))];
    const readinessByName = new Map(readiness.map((item) => [item.ingredient, item]));
    const ingredientRows = ingredients.map((name) => {
      const state = readinessByName.get(name) ?? { status: "to_add_to_list" };
      const label = state.status === "owned" ? "库存有（数量待确认）" : state.status === "already_on_list" ? "已在采购清单" : "待购买 · 数量待确认";
      return `<label class="plan-ingredient"><span>${state.status === "to_add_to_list" ? `<input type="checkbox" data-plan-buy-item value="${esc(name)}" checked>` : `<input type="checkbox" disabled ${state.status === "already_on_list" ? "checked" : ""}>`}</span><span>${esc(name)}</span><small>${label}</small></label>`;
    }).join("");
    const alternatives = openedPlanAlternatives.length
      ? `<div class="plan-alternatives">${openedPlanAlternatives.map((item) => `<div class="plan-alternative"><span><strong>${esc(item.recipe.name)}</strong><small>主动 ${Number(item.recipe.activeMinutes)} 分钟 · 总计 ${Number(item.recipe.totalMinutes)} 分钟</small></span><button type="button" class="secondary-button" data-replace-recipe="${esc(item.recipe.id)}">换成这道</button></div>`).join("")}</div>`
      : `<p class="support-copy">没有通过当前设备、忌口和过敏筛选的替换候选。</p>`;
    planDialog.innerHTML = `<div class="plan-dialog-head"><div><div class="eyebrow">${esc(day.date)} · 周计划菜谱</div><h2>${esc(main.name)}${side ? ` + ${esc(side.name)}` : ""}</h2></div><button type="button" class="dialog-close" data-close-plan-dialog aria-label="关闭">×</button></div>
      <div class="plan-recipe-times">${recipes.map((recipe) => `<span>${esc(recipe.name)}：主动操作 ${Number(recipe.activeMinutes)} 分钟 · 总耗时 ${Number(recipe.totalMinutes)} 分钟</span>`).join("")}</div>
      <section><h3>必需食材</h3><div class="plan-ingredient-list">${ingredientRows || `<p class="support-copy">菜谱尚未登记必需食材。</p>`}</div><div class="dialog-actions"><button type="button" class="primary-button" data-add-plan-shopping ${readiness.some((item) => item.status === "to_add_to_list") ? "" : "disabled"}>加入选中的采购项</button></div></section>
      <section><h3>设备与厨具</h3><p class="support-copy">${esc([...new Set(recipes.flatMap((recipe) => [...list(recipe.appliances).map((item) => equipmentLabels[item] ?? item), ...list(recipe.cookware)]))].join("、") || "菜谱未标注额外设备")}</p></section>
      ${recipes.map((recipe) => `<section><h3>${esc(recipe.name)} · 做法</h3><ol class="recipe-steps">${list(recipe.steps).map((step) => `<li>${esc(step)}</li>`).join("")}</ol></section>`).join("")}
      <section><h3>备料状态</h3><p class="support-copy">${esc(readiness.map((item) => `${item.ingredient}：${item.status === "owned" ? "库存有（数量未核验）" : item.status === "already_on_list" ? "已在采购清单" : "待加入采购清单"}`).join("；") || "无必需食材记录")}</p></section>
      <section><h3>换一道</h3>${alternatives}</section>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-plan-completed="${day.completed ? "false" : "true"}">${day.completed ? "撤销已完成" : "我做了这道菜"}</button>${day.hasDinnerLog ? `<span class="support-copy">当天另有晚餐记录</span>` : ""}<button type="button" class="text-button" data-record-plan-meal>记录这顿饭</button></div>`;
  }
  async function planDialogWrite(context, url, payload, method = "POST") {
    const pending = getPendingWrite(url, payload);
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
    const result = await response.json();
    if (!isCurrent(context)) return false;
    if (!response.ok) {
      localStorage.removeItem(pending.key);
      if (response.status === 409) {
        await refreshData();
        if (isCurrent(context) && openedPlanDate) await openPlanDay(openedPlanDate);
      }
      throw new Error(result.error || "操作失败。");
    }
    localStorage.removeItem(pending.key);
    if (result.plan) getData().weeklyPlan = result.plan;
    if (result.inventory) getData().inventory = result.inventory;
    renderPage();
    return true;
  }
  async function onPlanDialogClick(event) {
    if (event.target.closest("[data-close-plan-dialog]") || event.target === planDialog) { invalidateDialog(); planDialog.close(); return; }
    const context = openedPlanContext;
    if (!context || !isCurrent(context)) return;
    const day = context.day;
    if (getData()?.weeklyPlan?.weekStartDate !== context.weekStartDate
      || getData()?.weeklyPlan?.updatedAt !== context.updatedAt) {
      toast("计划已更新，请重新打开这一天后核对。");
      await openPlanDay(day.date);
      return;
    }
    try {
      if (event.target.closest("[data-add-plan-shopping]")) {
        const items = [...planDialog.querySelectorAll("[data-plan-buy-item]:checked")].map((input) => input.value);
        if (!items.length) { toast("先勾选要加入采购清单的食材。"); return; }
        const endpoint = "/api/shopping-list/add-from-plan";
        if (!await planDialogWrite(context, endpoint, { weekStartDate: context.weekStartDate, date: day.date, updatedAt: context.updatedAt, recipeIds: [day.mainRecipe.id, ...(day.sideRecipe ? [day.sideRecipe.id] : [])], items })) return;
        toast("已加入采购清单；数量待确认。");
        if (isCurrent(context)) await openPlanDay(day.date);
      } else if (event.target.closest("[data-plan-completed]")) {
        const completed = event.target.closest("[data-plan-completed]").dataset.planCompleted === "true";
        const endpoint = `/api/weekly-plan/${encodeURIComponent(context.weekStartDate)}/day/${encodeURIComponent(day.date)}/complete`;
        if (!await planDialogWrite(context, endpoint, { weekStartDate: context.weekStartDate, date: day.date, recipeId: day.mainRecipe.id, updatedAt: context.updatedAt, completed })) return;
        toast(completed ? "已标记计划菜完成。" : "已撤销完成状态。");
        if (isCurrent(context)) await openPlanDay(day.date);
      } else if (event.target.closest("[data-replace-recipe]")) {
        const recipeId = event.target.closest("[data-replace-recipe]").dataset.replaceRecipe;
        const endpoint = `/api/weekly-plan/${encodeURIComponent(context.weekStartDate)}/day/${encodeURIComponent(day.date)}/replace`;
        if (!await planDialogWrite(context, endpoint, { recipeId, updatedAt: context.updatedAt })) return;
        toast("计划菜已更换，备料状态已更新。");
        if (isCurrent(context)) await openPlanDay(day.date);
      } else if (event.target.closest("[data-record-plan-meal]")) {
        const endpoint = "/api/meals";
        const payload = { date: day.date, mealType: "dinner", foods: [{ name: day.mainRecipe.name, amount: "1份" }, ...(day.sideRecipe ? [{ name: day.sideRecipe.name, amount: "1份" }] : [])], note: "来自周计划的饮食记录" };
        const pending = getPendingWrite(endpoint, payload);
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
        const result = await response.json();
        if (!isCurrent(context)) return;
        if (!response.ok) throw new Error(result.error || "记录饮食失败。");
        localStorage.removeItem(pending.key);
        toast("晚餐记录已保存；计划完成状态仍需单独标记。");
        await refreshData();
        if (isCurrent(context)) await openPlanDay(day.date);
      }
    } catch (error) { if (isCurrent(context)) toast(error instanceof Error ? error.message : "操作失败，请重试。"); }
  }

  planDialog.addEventListener("click", onPlanDialogClick);
  return { openPlanDay };
}
