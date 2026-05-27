const $ = (id) => document.getElementById(id);

const state = {
  energyLevel: "normal",
  inventory: null,
  selectedRecipe: "",
  timeline: [],
  timelineIndex: 0,
};

function userId() {
  return $("userId").value.trim() || "daily_user";
}

function setStatus(text) {
  $("statusText").textContent = text;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function storageLabel(value) {
  return {
    fridge: "冷藏",
    freezer: "冷冻",
    pantry: "储藏",
    room_temp: "室温",
  }[value] || value || "";
}

function metaFor(item) {
  return [item.amount, storageLabel(item.storage), item.expiresAt, item.expiresSoon ? "快过期" : ""]
    .filter(Boolean)
    .join(" · ");
}

function renderItems(container, items, options = {}) {
  if (!items.length) {
    container.className = "item-list empty";
    container.textContent = options.emptyText || "暂无记录";
    return;
  }

  container.className = "item-list";
  container.innerHTML = items.map((item) => `
    <div class="food-row ${item.expiresSoon ? "urgent" : ""}">
      <div>
        <div class="food-name">${escapeHtml(item.name)}</div>
        <div class="food-meta">${escapeHtml(metaFor(item))}</div>
      </div>
      ${options.removable ? `<button type="button" data-use="${escapeHtml(item.name)}" title="标记用完">✓</button>` : ""}
      ${options.buyable ? `<button type="button" data-bought="${escapeHtml(item.name)}" title="买到了，转入库存">→</button>` : ""}
    </div>
  `).join("");

  container.querySelectorAll("[data-use]").forEach((button) => {
    button.addEventListener("click", async () => markUsed(button.dataset.use));
  });
  container.querySelectorAll("[data-bought]").forEach((button) => {
    button.addEventListener("click", async () => markBought(button.dataset.bought));
  });
}

async function refresh() {
  setStatus("读取中");
  const data = await api(`/api/users/${encodeURIComponent(userId())}/workflow/today`);
  const workflow = data.workflow;
  state.inventory = workflow.inventory;

  const available = workflow.inventory.availableIngredients.filter((item) => !item.status || item.status === "available");
  const shopping = workflow.inventory.shoppingList.filter((item) => !item.status || item.status === "planned" || item.status === "available");

  $("availableMetric").textContent = workflow.metrics.availableCount;
  $("expiringMetric").textContent = workflow.metrics.expiringCount;
  $("shoppingMetric").textContent = workflow.metrics.shoppingCount;
  $("mealMetric").textContent = workflow.metrics.mealsLoggedToday;
  $("inventoryCount").textContent = available.length;
  $("shoppingCount").textContent = shopping.length;

  renderItems($("inventoryList"), available, { emptyText: "暂无库存", removable: true });
  renderItems($("shoppingList"), shopping, { emptyText: "暂无购物项", buyable: true });
  setStatus(workflow.nextActions[0] || "已同步");
}

async function addIngredient(event) {
  event.preventDefault();
  const name = $("ingredientName").value.trim();
  if (!name) return;

  await api(`/api/users/${encodeURIComponent(userId())}/ingredients`, {
    method: "POST",
    body: JSON.stringify({
      availableIngredients: [{
        name,
        amount: $("ingredientAmount").value.trim() || undefined,
        storage: $("ingredientStorage").value,
        expiresAt: $("ingredientExpires").value || undefined,
        status: "available",
      }],
    }),
  });
  event.target.reset();
  $("ingredientStorage").value = "fridge";
  await refresh();
}

async function addShopping(event) {
  event.preventDefault();
  const name = $("shoppingName").value.trim();
  if (!name) return;
  await api(`/api/users/${encodeURIComponent(userId())}/ingredients`, {
    method: "POST",
    body: JSON.stringify({ shoppingList: [{ name, status: "planned" }] }),
  });
  event.target.reset();
  await refresh();
}

async function markBought(name) {
  await api(`/api/users/${encodeURIComponent(userId())}/ingredients`, {
    method: "POST",
    body: JSON.stringify({
      availableIngredients: [{ name, status: "available", storage: "fridge" }],
    }),
  });
  await api(`/api/users/${encodeURIComponent(userId())}/ingredients/status`, {
    method: "PATCH",
    body: JSON.stringify({ itemName: name, status: "used", note: "购物清单已买到并转入库存" }),
  }).catch(() => {});
  await refresh();
}

async function markUsed(name) {
  await api(`/api/users/${encodeURIComponent(userId())}/ingredients/status`, {
    method: "PATCH",
    body: JSON.stringify({ itemName: name, status: "used", note: "页面标记用完" }),
  });
  await refresh();
}

function setMode(mode) {
  state.energyLevel = mode;
  $("normalMode").classList.toggle("active", mode === "normal");
  $("lowMode").classList.toggle("active", mode === "low");
}

async function generateShoppingPlan() {
  setStatus("生成购物建议");
  const data = await api(`/api/users/${encodeURIComponent(userId())}/workflow/shopping-plan`, {
    method: "POST",
    body: JSON.stringify({
      timeLimitMinutes: Number($("timeLimit").value || 20),
      energyLevel: state.energyLevel,
      desiredStyle: $("desiredStyle").value.trim() || undefined,
    }),
  });

  const items = data.shoppingItems.map((item) => item.name);
  const candidates = data.candidates.slice(0, 3).map((candidate) => `
    <div class="candidate">
      <strong>${escapeHtml(candidate.name)}</strong>
      <span>${candidate.activeMinutes} 分钟主动 · 缺 ${escapeHtml(candidate.missingIngredients.join("、") || "无")}</span>
    </div>
  `).join("");

  $("shoppingPlanOutput").innerHTML = `
    <p><strong>建议补齐：</strong>${escapeHtml(items.join("、") || "当前库存已经能做饭")}</p>
    ${candidates}
  `;
  await refresh();
  setStatus("购物建议已生成");
}

async function generatePlan(forceLow = false) {
  setStatus("生成中");
  if (forceLow) setMode("low");
  const available = state.inventory?.availableIngredients
    ?.filter((item) => !item.status || item.status === "available")
    ?.map((item) => item.name) ?? [];

  const data = await api(`/api/users/${encodeURIComponent(userId())}/cooking-plan`, {
    method: "POST",
    body: JSON.stringify({
      availableIngredients: available,
      timeLimitMinutes: Number($("timeLimit").value || 20),
      energyLevel: state.energyLevel,
      desiredStyle: $("desiredStyle").value.trim() || undefined,
    }),
  });

  const text = data.result?.content?.find((block) => block.type === "text")?.text || "没有返回计划。";
  $("planOutput").textContent = text;
  const selected = data.result?.details?.selectedRecipes?.[0]?.name;
  if (selected) {
    state.selectedRecipe = selected;
    $("feedbackRecipe").value = selected;
    $("mealFoods").value = data.result.details.selectedRecipes.map((recipe) => recipe.name).join("、");
  }
  state.timeline = extractTimeline(text);
  state.timelineIndex = 0;
  renderTimelineStep();
  setStatus("计划已生成");
}

function extractTimeline(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s*\d/.test(line) || /^\d+[-~至]/.test(line))
    .map((line) => line.replace(/^[-*]\s*/, ""));
}

function renderTimelineStep() {
  if (state.timeline.length === 0) {
    $("timelineLabel").textContent = "时间线未生成";
    $("currentTimelineStep").textContent = "生成晚饭计划后，可按步骤推进。";
    return;
  }
  $("timelineLabel").textContent = `${state.timelineIndex + 1} / ${state.timeline.length}`;
  $("currentTimelineStep").textContent = state.timeline[state.timelineIndex];
}

function moveTimeline(delta) {
  if (state.timeline.length === 0) return;
  state.timelineIndex = Math.max(0, Math.min(state.timeline.length - 1, state.timelineIndex + delta));
  renderTimelineStep();
}

async function submitMeal(event) {
  event.preventDefault();
  const foods = $("mealFoods").value
    .split(/[、,，;；]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, amount: "1 份" }));
  if (foods.length === 0) return;

  await api(`/api/users/${encodeURIComponent(userId())}/meals`, {
    method: "POST",
    body: JSON.stringify({
      mealType: "dinner",
      foods,
      note: "前端工作流记录",
    }),
  });
  $("mealFoods").value = "";
  setStatus("晚餐已记录");
  await refresh();
}

async function submitFeedback(event) {
  event.preventDefault();
  const recipeName = $("feedbackRecipe").value.trim() || state.selectedRecipe;
  const rating = $("feedbackRating").value ? Number($("feedbackRating").value) : undefined;
  const actual = $("actualMinutes").value ? Number($("actualMinutes").value) : undefined;
  await api(`/api/users/${encodeURIComponent(userId())}/cooking-feedback`, {
    method: "POST",
    body: JSON.stringify({
      recipeName,
      rating,
      actualActiveMinutes: actual,
      actualTotalMinutes: actual,
      wouldCookAgain: $("wouldCookAgain").checked || undefined,
      tooTiring: $("tooTiring").checked || undefined,
      note: $("feedbackNote").value.trim() || undefined,
    }),
  });
  $("feedbackNote").value = "";
  $("feedbackRating").value = "";
  $("actualMinutes").value = "";
  $("wouldCookAgain").checked = false;
  $("tooTiring").checked = false;
  setStatus("反馈已记录");
}

async function generateWeekendPrep() {
  setStatus("生成备菜任务");
  const data = await api(`/api/users/${encodeURIComponent(userId())}/workflow/weekend-prep`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (!data.tasks.length) {
    $("weekendOutput").className = "prep-grid empty";
    $("weekendOutput").textContent = "暂无备菜任务";
  } else {
    $("weekendOutput").className = "prep-grid";
    $("weekendOutput").innerHTML = data.tasks.slice(0, 6).map((task) => `
      <article class="prep-card">
        <strong>${escapeHtml(task.recipeName)}</strong>
        <p>${escapeHtml(task.weekendPrep)}</p>
        <small>已有：${escapeHtml(task.matchedIngredients.join("、") || "无")} · 缺：${escapeHtml(task.missingIngredients.join("、") || "无")}</small>
      </article>
    `).join("");
  }
  setStatus("备菜任务已生成");
}

$("refreshBtn").addEventListener("click", refresh);
$("shoppingPlanBtn").addEventListener("click", generateShoppingPlan);
$("ingredientForm").addEventListener("submit", addIngredient);
$("shoppingForm").addEventListener("submit", addShopping);
$("generateBtn").addEventListener("click", () => generatePlan(false));
$("tiredBtn").addEventListener("click", () => generatePlan(true));
$("mealForm").addEventListener("submit", submitMeal);
$("feedbackForm").addEventListener("submit", submitFeedback);
$("weekendPrepBtn").addEventListener("click", generateWeekendPrep);
$("normalMode").addEventListener("click", () => setMode("normal"));
$("lowMode").addEventListener("click", () => setMode("low"));
$("prevStepBtn").addEventListener("click", () => moveTimeline(-1));
$("nextStepBtn").addEventListener("click", () => moveTimeline(1));
$("userId").addEventListener("change", refresh);

refresh().catch((err) => {
  console.error(err);
  setStatus("读取失败");
});

// ====== Onboarding 引导 ======

const ONB_STORAGE_KEY = "diet_onboarded";
let onbStep = 1;
const onbTotalSteps = 4;

function showOnboarding() {
  $("onboardingOverlay").classList.remove("hidden");
  renderOnbStep();
}

function hideOnboarding() {
  $("onboardingOverlay").classList.add("hidden");
}

function renderOnbStep() {
  for (let i = 1; i <= onbTotalSteps; i++) {
    const el = $(`onbStep${i}`);
    if (i === onbStep) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }
  $("onbStepIndicator").textContent = `${onbStep} / ${onbTotalSteps}`;
  $("onbProgressBar").style.width = `${(onbStep / onbTotalSteps) * 100}%`;
  $("onbPrev").classList.toggle("hidden", onbStep === 1);
  $("onbSkip").classList.toggle("hidden", onbStep === onbTotalSteps);
  $("onbNext").classList.toggle("hidden", onbStep === onbTotalSteps);
  $("onbFinish").classList.toggle("hidden", onbStep !== onbTotalSteps);
}

function splitCSV(value) {
  return value.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);
}

async function saveOnboardingData() {
  const uid = userId();
  const promises = [];

  // Step 1: 用户画像
  if ($("onbGoal").value || $("onbHeight").value || $("onbWeight").value) {
    promises.push(api(`/api/users/${encodeURIComponent(uid)}/profile`, {
      method: "POST",
      body: JSON.stringify({
        goal: $("onbGoal").value || undefined,
        heightCm: $("onbHeight").value ? Number($("onbHeight").value) : undefined,
        weightKg: $("onbWeight").value ? Number($("onbWeight").value) : undefined,
        avoidFoods: splitCSV($("onbAvoid").value),
        preferences: splitCSV($("onbPref").value),
      }),
    }));
  }

  // Step 2: 厨房配置
  const cookware = [];
  document.querySelectorAll("#onbCookwareGroup input[type=checkbox]:checked").forEach((cb) => cookware.push(cb.value));
  const cookPrefs = [];
  document.querySelectorAll("#onbCookPrefsGroup input[type=checkbox]:checked").forEach((cb) => cookPrefs.push(cb.value));
  promises.push(api(`/api/users/${encodeURIComponent(uid)}/kitchen`, {
    method: "POST",
    body: JSON.stringify({
      burners: Number($("onbBurners").value),
      hasOven: $("onbOven").value === "1",
      cookware,
      cookingPreferences: cookPrefs,
    }),
  }));

  // Step 3: 常备食材
  const ingredients = [];
  document.querySelectorAll("#onbStep3 .onb-checkbox-grid input[type=checkbox]:checked").forEach((cb) => {
    ingredients.push({ name: cb.value, status: "available", storage: "fridge" });
  });
  const extra = splitCSV($("onbExtraIngredients").value);
  extra.forEach((name) => ingredients.push({ name, status: "available", storage: "fridge" }));
  if (ingredients.length > 0) {
    promises.push(api(`/api/users/${encodeURIComponent(uid)}/ingredients`, {
      method: "POST",
      body: JSON.stringify({ availableIngredients: ingredients }),
    }));
  }

  await Promise.all(promises);
}

$("onbNext").addEventListener("click", () => {
  if (onbStep < onbTotalSteps) {
    onbStep++;
    renderOnbStep();
  }
});

$("onbPrev").addEventListener("click", () => {
  if (onbStep > 1) {
    onbStep--;
    renderOnbStep();
  }
});

$("onbSkip").addEventListener("click", () => {
  localStorage.setItem(ONB_STORAGE_KEY, "skipped");
  hideOnboarding();
});

$("onbFinish").addEventListener("click", async () => {
  setStatus("保存设置中...");
  try {
    await saveOnboardingData();
    localStorage.setItem(ONB_STORAGE_KEY, "done");
    hideOnboarding();
    setStatus("设置已保存");
    await refresh();
  } catch (err) {
    console.error("Onboarding save error:", err);
    setStatus("保存失败：" + err.message);
  }
});

// 首次访问时检查是否需要引导
(async function checkOnboarding() {
  const onboarded = localStorage.getItem(ONB_STORAGE_KEY);
  if (onboarded) return;
  try {
    const data = await api(`/api/users/${encodeURIComponent(userId())}/workflow/today`);
    const profile = data.workflow?.kitchen;
    // 如果厨房配置有过更新（非默认值），说明已经设置过
    const hasCustomized = profile && (
      profile.cookware?.length > 3 ||
      profile.tastePreferences?.length > 0 ||
      new Date(profile.updatedAt) < new Date("2026-01-01") // 安全兜底
    );
    if (!hasCustomized) {
      showOnboarding();
    } else {
      localStorage.setItem(ONB_STORAGE_KEY, "done");
    }
  } catch {
    // API 失败不影响，第一次打开也会触发引导
    showOnboarding();
  }
})();
