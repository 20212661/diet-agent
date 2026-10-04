import { createPlanDialog } from "./planDialog.js";
import { createChatController } from "./chatController.js";
import { esc, list, clientOperationId, readableDate, splitField } from "./viewFormatters.js";
import { renderProfilePage, renderKitchenPage } from "./profileKitchenViews.js";
import { renderInventoryPage, parseIngredientLines, parseReceiptText, receiptPreviewHtml } from "./inventoryView.js";
import { renderDiaryPage, mealEditorForm } from "./diaryView.js";
import { modelStatusLabel, renderOverviewPage, renderPlanPage, renderAgentPage } from "./planAgentViews.js";

const pages = [
  { id: "overview", title: "今日总览", icon: "◫", description: "今天的饮食节奏、食材和计划都在这里。" },
  { id: "profile", title: "我的资料", icon: "◉", description: "让饮食助手按你的目标、口味和限制来给建议。" },
  { id: "kitchen", title: "厨房设置", icon: "♨", description: "设备与做饭习惯会影响菜谱和计划推荐。" },
  { id: "inventory", title: "食材库存", icon: "▤", description: "查看现有食材和待采购清单。" },
  { id: "diary", title: "饮食记录", icon: "◷", description: "回顾今天记录的三餐和热量信息。" },
  { id: "plan", title: "每周计划", icon: "▦", description: "按一周菜单查看每日安排与完成进度。" },
  { id: "agent", title: "智能体信息", icon: "✳", description: "查看模型、工具和本次对话可用的个人上下文。" },
];

const slashCommands = [
  { command: "/profile", label: "打开我的资料", page: "profile" },
  { command: "/kitchen", label: "查看厨房设置", page: "kitchen" },
  { command: "/inventory", label: "查看食材库存", page: "inventory" },
  { command: "/today", label: "打开今日饮食记录", page: "diary" },
  { command: "/plan", label: "查看每周计划", page: "plan" },
  { command: "/agent", label: "查看智能体信息", page: "agent" },
  { command: "/help", label: "显示快捷命令", page: "help" },
];

let data = null;
let currentPage = "overview";
let selectedPaletteIndex = 0;
let receiptDraft = [];
let receiptFile = null;
let editingInventoryItemId = null;
let selectedDiaryDate = null;
let diaryState = null;
let editingMealId = null;

const $ = (selector) => document.querySelector(selector);
const pageContent = $("#page-content");
const chatInput = $("#chat-input");
const palette = $("#command-palette");
const paletteInput = $("#palette-input");
const toastNode = $("#toast");

const { sendChat, bindRecoveryUser, getPendingWrite, statusLabel: chatStatusLabel } = createChatController({
  $, esc, getData: () => data, getCurrentPage: () => currentPage, toast, renderPage, refreshData,
  modelStatusLabel, clientOperationId, useSlash, slashCommands,
});

const { openPlanDay } = createPlanDialog({ getData: () => data, esc, list, toast, getPendingWrite, refreshData, renderPage });

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastNode.classList.remove("show"), 2100);
}

function renderPage() {
  const selected = pages.find((page) => page.id === currentPage) ?? pages[0];
  $("#page-title").textContent = selected.title;
  document.title = `${selected.title} · 晚饭工作流`;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === currentPage));
  if (!data) {
    pageContent.innerHTML = `<div class="skeleton"></div><div class="skeleton" style="margin-top:14px"></div>`;
    return;
  }
  if (currentPage === "overview") {
    pageContent.innerHTML = renderOverviewPage(data);
  } else if (currentPage === "profile") {
    pageContent.innerHTML = renderProfilePage(data.profile, selected.description);
    pageContent.querySelector("[data-save-form]").dataset.updatedAt = data.profile?.updatedAt ?? "";
  } else if (currentPage === "kitchen") {
    pageContent.innerHTML = renderKitchenPage(data.kitchen, selected.description);
    pageContent.querySelector("[data-save-form]").dataset.updatedAt = data.kitchen?.updatedAt ?? "";
  } else if (currentPage === "inventory") {
    pageContent.innerHTML = renderInventoryPage(data.inventory, selected.description, editingInventoryItemId, receiptDraft);
  } else if (currentPage === "diary") {
    pageContent.innerHTML = renderDiaryPage(data, selected.description, selectedDiaryDate, diaryState, editingMealId);
  } else if (currentPage === "plan") {
    pageContent.innerHTML = renderPlanPage(data, selected.description);
  } else {
    pageContent.innerHTML = renderAgentPage(data, selected.description);
  }
}

async function refreshData() {
  $("#refresh-button").style.transform = "rotate(90deg)";
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("读取失败");
    data = await response.json();
    bindRecoveryUser(data.userId);
    $("#sidebar-user").textContent = data.profile?.customGoal ? `${data.userId} · ${data.profile.customGoal}` : data.userId;
    $("#today-date").textContent = readableDate(data.date);
    $("#agent-status").textContent = chatStatusLabel();
    $("#model-label").textContent = data.agent.model;
    renderPage();
  } catch {
    pageContent.innerHTML = `<div class="page-intro"><div class="eyebrow">LOCAL WORKSPACE</div><h1>暂时无法读取工作区</h1><p>请确认本地服务正在运行，然后刷新页面。</p></div><button class="primary-button" id="retry-button">重新连接</button>`;
    $("#retry-button")?.addEventListener("click", refreshData);
  } finally {
    $("#refresh-button").style.transform = "";
  }
}

function navigate(pageId) {
  if (pageId === "help") { showToastHelp(); return; }
  currentPage = pages.some((page) => page.id === pageId) ? pageId : "overview";
  renderPage();
  if (currentPage === "diary") loadDiary(selectedDiaryDate ?? data?.date);
  closePalette();
}

async function loadDiary(date) {
  if (!date) return;
  selectedDiaryDate = date;
  renderPage();
  try {
    const [dayResponse, datesResponse] = await Promise.all([
      fetch(`/api/meals?date=${encodeURIComponent(date)}`, { cache: "no-store" }),
      fetch("/api/meals/dates?limit=14", { cache: "no-store" }),
    ]);
    if (!dayResponse.ok || !datesResponse.ok) throw new Error("饮食记录读取失败。");
    diaryState = { ...(await dayResponse.json()), recentDates: (await datesResponse.json()).dates ?? [] };
    renderPage();
  } catch (error) {
    toast(error instanceof Error ? error.message : "饮食记录读取失败。");
  }
}

async function saveMealForm(form) {
  const fields = new FormData(form);
  const foods = String(fields.get("foods") ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, ...amount] = line.split("|").map((part) => part.trim());
    return { name, amount: amount.join(" | ") };
  });
  if (!foods.length || foods.some((food) => !food.name)) { toast("请至少填写一项食物名称。"); return; }
  const payload = { date: fields.get("date"), mealType: fields.get("mealType"), foods, note: fields.get("note") ?? "" };
  const mealId = form.dataset.mealId;
  const endpoint = mealId ? `/api/meals/${encodeURIComponent(mealId)}` : "/api/meals";
  const pending = getPendingWrite(endpoint, payload);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch(endpoint, { method: mealId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存饮食记录失败。");
    localStorage.removeItem(pending.key);
    editingMealId = null;
    toast(mealId ? "饮食记录已修改。" : "饮食记录已新增。");
    await loadDiary(String(payload.date));
    await refreshData();
  } catch (error) {
    button.disabled = false;
    toast(error instanceof Error ? error.message : "保存失败，请重试。");
  }
}

async function deleteMeal(id) {
  if (!window.confirm("确认移除这条饮食记录？记录可以在“已移除记录”中恢复。")) return;
  const endpoint = `/api/meals/${encodeURIComponent(id)}`;
  const payload = {};
  const pending = getPendingWrite(endpoint, payload);
  try {
    const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ operationId: pending.operationId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "移除失败。");
    localStorage.removeItem(pending.key);
    toast("记录已移除，可在下方恢复。");
    await loadDiary(selectedDiaryDate);
    await refreshData();
  } catch (error) { toast(error instanceof Error ? error.message : "移除失败。"); }
}

async function restoreMeal(id) {
  const endpoint = `/api/meals/${encodeURIComponent(id)}/restore`;
  const pending = getPendingWrite(endpoint, {});
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ operationId: pending.operationId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "恢复失败。");
    localStorage.removeItem(pending.key);
    toast("饮食记录已恢复。");
    await loadDiary(selectedDiaryDate);
    await refreshData();
  } catch (error) { toast(error instanceof Error ? error.message : "恢复失败。"); }
}

function showToastHelp() { toast("快捷命令：/profile /kitchen /inventory /today /plan /agent /help"); }
function closePalette() { palette.hidden = true; }
function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  selectedPaletteIndex = 0;
  renderPaletteOptions();
  requestAnimationFrame(() => paletteInput.focus());
}

function filteredOptions() {
  const query = paletteInput.value.trim().toLowerCase();
  return pages.filter((page) => !query || `${page.title} ${page.description}`.toLowerCase().includes(query));
}

function renderPaletteOptions() {
  const options = filteredOptions();
  if (selectedPaletteIndex >= options.length) selectedPaletteIndex = Math.max(0, options.length - 1);
  $("#palette-options").innerHTML = options.length ? options.map((page, index) => `<button class="palette-option${index === selectedPaletteIndex ? " selected" : ""}" data-option-page="${esc(page.id)}"><span>${page.icon}</span><span><strong>${esc(page.title)}</strong><small>${esc(page.description)}</small></span><kbd>Ctrl ${index + 1}</kbd></button>`).join("") : `<div class="support-copy" style="padding:14px">没有找到匹配页面</div>`;
}

function setSlashMenu() {
  const menu = $("#slash-menu");
  const value = chatInput.value;
  const match = value.startsWith("/") && !value.includes(" ") ? value.slice(1).toLowerCase() : null;
  if (match === null) { menu.hidden = true; return; }
  const options = slashCommands.filter((item) => `${item.command} ${item.label}`.toLowerCase().includes(match));
  menu.innerHTML = options.map((item, index) => `<button type="button" class="slash-option${index === 0 ? " active" : ""}" data-slash="${esc(item.command)}"><code>${esc(item.command)}</code><span>${esc(item.label)}</span></button>`).join("") || `<div class="support-copy" style="padding:9px">没有匹配的快捷命令</div>`;
  menu.hidden = false;
}

function useSlash(command) {
  const item = slashCommands.find((option) => option.command === command);
  if (!item) return;
  chatInput.value = "";
  $("#slash-menu").hidden = true;
  if (item.page === "help") showToastHelp(); else navigate(item.page);
}

function showReceiptDraft() {
  const preview = $("#receipt-preview");
  if (preview) preview.innerHTML = receiptPreviewHtml(receiptDraft);
  const confirm = $("#receipt-confirm");
  if (confirm) {
    confirm.disabled = receiptDraft.length === 0;
    confirm.textContent = `确认加入冰箱${receiptDraft.length ? `（${receiptDraft.length} 项）` : ""}`;
  }
}

async function recognizeReceipt() {
  const text = $("#receipt-text")?.value.trim() ?? "";
  const button = $("#receipt-recognize");
  if (!receiptFile && !text) { toast("请先上传清单文件或粘贴商品清单。"); return; }
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "正在识别…";
  try {
    if (receiptFile && receiptFile.type.startsWith("image/")) {
      if (receiptFile.size > 4_500_000) throw new Error("图片不能超过 4.5 MB。");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("读取图片失败，请重试。"));
        reader.readAsDataURL(receiptFile);
      });
      const response = await fetch("/api/receipt/parse", { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(data.userId) }, body: JSON.stringify({ data: dataUrl, mimeType: receiptFile.type }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "清单识别失败。");
      receiptDraft = list(result.items);
    } else {
      const source = receiptFile ? await receiptFile.text() : text;
      receiptDraft = parseReceiptText(source);
      if (!receiptDraft.length) throw new Error("没有解析到商品。请按“名称 | 数量”逐行整理，或上传图片。");
    }
    showReceiptDraft();
    toast(receiptDraft.length ? `识别到 ${receiptDraft.length} 项，请核对后确认。` : "没有识别到可入库食材。");
  } catch (error) {
    toast(error instanceof Error ? error.message : "清单识别失败，请重试。");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function confirmReceiptImport() {
  const selected = receiptDraft.flatMap((item, index) => {
    if (!$(`[data-receipt-selected="${index}"]`)?.checked) return [];
    const name = $(`[data-receipt-name="${index}"]`)?.value.trim();
    if (!name) return [];
    const amount = $(`[data-receipt-amount="${index}"]`)?.value.trim();
    const storage = $(`[data-receipt-storage="${index}"]`)?.value;
    return [{ name, ...(amount ? { amount } : {}), storage, ...(item.category ? { category: item.category } : {}), status: "available" }];
  });
  if (!selected.length) { toast("请至少勾选一项并填写食材名称。"); return; }
  const button = $("#receipt-confirm");
  button.disabled = true;
  button.textContent = "正在加入冰箱…";
  try {
    const pending = getPendingWrite("/api/inventory/import", { items: selected });
    const response = await fetch("/api/inventory/import", { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "导入失败。");
    localStorage.removeItem(pending.key);
    data = result.data;
    receiptDraft = [];
    receiptFile = null;
    renderPage();
    toast(`${result.count} 项食材已保存，饮食助手下次回复会读取最新库存。`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "导入失败，请重试。");
    button.disabled = false;
    showReceiptDraft();
  }
}

async function saveEditorForm(form) {
  const fields = new FormData(form);
  let endpoint;
  let payload;
  if (form.dataset.saveForm === "profile") {
    endpoint = "/api/profile";
    payload = {
      updatedAt: form.dataset.updatedAt,
      goal: fields.get("goal"), customGoal: fields.get("customGoal"),
      heightCm: fields.get("heightCm"), weightKg: fields.get("weightKg"), age: fields.get("age"),
      gender: fields.get("gender"), activityLevel: fields.get("activityLevel"),
      avoidFoods: splitField(fields.get("avoidFoods")), allergies: splitField(fields.get("allergies")),
      preferences: splitField(fields.get("preferences")), medicalNotes: splitField(fields.get("medicalNotes")),
    };
  } else if (form.dataset.saveForm === "kitchen") {
    endpoint = "/api/kitchen";
    payload = {
      updatedAt: form.dataset.updatedAt,
      burners: fields.get("burners"), hasOven: fields.get("hasOven") === "true",
      hasMicrowave: fields.get("hasMicrowave") === "true", hasRiceCooker: fields.get("hasRiceCooker") === "true",
      maxActiveMinutes: fields.get("maxActiveMinutes"), maxTotalMinutes: fields.get("maxTotalMinutes"),
      cookware: splitField(fields.get("cookware")), tastePreferences: splitField(fields.get("tastePreferences")),
      cookingPreferences: splitField(fields.get("cookingPreferences")),
    };
  } else {
    endpoint = "/api/inventory";
    payload = {
      updatedAt: form.dataset.updatedAt,
      availableIngredients: parseIngredientLines(fields.get("availableIngredients"), data.inventory?.availableIngredients),
      shoppingList: parseIngredientLines(fields.get("shoppingList"), data.inventory?.shoppingList),
    };
  }
  const button = form.querySelector("button[type=submit]");
  const buttonLabel = button.textContent;
  button.disabled = true;
  button.textContent = "正在保存…";
  const pending = getPendingWrite(endpoint, payload);
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败。");
    localStorage.removeItem(pending.key);
    data = result.data;
    renderPage();
    toast("已保存到本机，饮食助手下次回复会读取最新信息。");
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败，请重试。");
    button.disabled = false;
    button.textContent = buttonLabel;
  }
}

async function saveInventoryItemForm(form) {
  const fields = new FormData(form);
  const create = form.dataset.createItem === "true";
  const itemId = form.dataset.itemId;
  const payload = {
    name: fields.get(create ? "new-name" : `item-${itemId}-name`),
    amount: fields.get(create ? "new-amount" : `item-${itemId}-amount`),
    storage: fields.get(create ? "new-storage" : `item-${itemId}-storage`),
    expiresAt: fields.get(create ? "new-expiresAt" : `item-${itemId}-expiresAt`),
    status: fields.get(create ? "new-status" : `item-${itemId}-status`),
    ...(create ? {} : { updatedAt: form.dataset.updatedAt }),
  };
  const endpoint = create ? "/api/inventory/items" : `/api/inventory/items/${encodeURIComponent(itemId)}`;
  const method = create ? "POST" : "PATCH";
  const button = form.querySelector("button[type=submit]");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "正在保存…";
  const pending = getPendingWrite(endpoint, payload);
  try {
    const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) }, body: JSON.stringify({ ...pending.payload, operationId: pending.operationId }) });
    const result = await response.json();
    if (response.status === 409) {
      localStorage.removeItem(pending.key);
      if (result.inventory) data.inventory = result.inventory;
      editingInventoryItemId = null;
      renderPage();
      toast("库存已变化，已刷新。请重新打开该项并确认后再保存。");
      return;
    }
    if (!response.ok) throw new Error(result.error || "保存失败。");
    localStorage.removeItem(pending.key);
    data.inventory = result.inventory;
    editingInventoryItemId = null;
    renderPage();
    toast(create ? "食材已添加。" : "食材已更新。");
  } catch (error) {
    button.disabled = false;
    button.textContent = label;
    toast(error instanceof Error ? error.message : "保存失败，请重试。");
  }
}

async function checkModelConnection(button) {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "正在验证…";
  try {
    const response = await fetch("/api/model/check", { method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(data.userId) }, body: "{}" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "连接检测失败。");
    data = result.data;
    renderPage();
    toast(modelStatusLabel(data.agent));
  } catch (error) {
    toast(error instanceof Error ? error.message : "连接检测失败；请检查配置和网络，或运行 npm run doctor。");
  } finally {
    if (button.isConnected) { button.disabled = false; button.textContent = "验证连接"; }
  }
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));

pageContent.addEventListener("submit", (event) => {
  const mealForm = event.target.closest("form[data-meal-form]");
  if (mealForm) {
    event.preventDefault();
    saveMealForm(mealForm);
    return;
  }
  const itemForm = event.target.closest("form[data-inventory-item-form]");
  if (itemForm) {
    event.preventDefault();
    saveInventoryItemForm(itemForm);
    return;
  }
  const form = event.target.closest("form[data-save-form]");
  if (!form) return;
  event.preventDefault();
  saveEditorForm(form);
});

pageContent.addEventListener("change", (event) => {
  if (event.target.matches("[data-diary-date]")) loadDiary(event.target.value);
  if (event.target.matches("#receipt-file")) {
    receiptFile = event.target.files?.[0] ?? null;
    const label = $("#receipt-file-name");
    if (label) label.textContent = receiptFile ? `${receiptFile.name} · ${(receiptFile.size / 1024).toFixed(0)} KB` : "支持 JPG、PNG、WebP、CSV、TXT，或直接粘贴清单。";
  }
});

pageContent.addEventListener("click", (event) => {
  if (event.target.closest("#receipt-recognize")) recognizeReceipt();
  if (event.target.closest("#receipt-confirm")) confirmReceiptImport();
  const editButton = event.target.closest("[data-edit-item]");
  if (editButton) {
    editingInventoryItemId = editButton.dataset.editItem;
    renderPage();
  }
  if (event.target.closest("[data-cancel-item-edit]")) {
    editingInventoryItemId = null;
    renderPage();
  }
  if (event.target.closest("[data-focus-inventory-add]")) {
    const input = pageContent.querySelector('[data-create-item] input[name="new-name"]');
    input?.focus();
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const planDay = event.target.closest("[data-plan-day]");
  if (planDay) openPlanDay(planDay.dataset.planDay);
  const editMeal = event.target.closest("[data-edit-meal]");
  if (editMeal) { editingMealId = editMeal.dataset.editMeal; renderPage(); }
  if (event.target.closest("[data-cancel-meal-edit]")) { editingMealId = null; renderPage(); }
  const removeMeal = event.target.closest("[data-delete-meal]");
  if (removeMeal) deleteMeal(removeMeal.dataset.deleteMeal);
  const restore = event.target.closest("[data-restore-meal]");
  if (restore) restoreMeal(restore.dataset.restoreMeal);
  const recent = event.target.closest("[data-diary-recent]");
  if (recent) loadDiary(recent.dataset.diaryRecent);
  if (event.target.closest("[data-toggle-meal-add]")) {
    const details = pageContent.querySelector("[data-new-meal-details]");
    if (details) { details.open = true; details.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  const acknowledge = event.target.closest("[data-onboarding-ack]");
  if (acknowledge) {
    try { localStorage.setItem(acknowledge.dataset.onboardingAck, "true"); } catch {}
    renderPage();
  }
  const checkButton = event.target.closest("[data-check-model]");
  if (checkButton) checkModelConnection(checkButton);
  const page = event.target.closest("[data-page]")?.dataset.page;
  const prompt = event.target.closest("[data-chat-prompt]")?.dataset.chatPrompt;
  if (page) navigate(page);
  if (prompt) { chatInput.value = prompt; chatInput.focus(); }
});

pageContent.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-plan-day]")) {
    event.preventDefault();
    openPlanDay(event.target.dataset.planDay);
  }
});

$("#navigation").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button) navigate(button.dataset.page);
});

$("#refresh-button").addEventListener("click", refreshData);
$("#user-button").addEventListener("click", () => navigate("profile"));
$("#context-button").addEventListener("click", () => navigate("profile"));
$("#agent-info-button").addEventListener("click", () => navigate("agent"));
$("#command-button").addEventListener("click", openPalette);
$("#palette-input").addEventListener("input", () => { selectedPaletteIndex = 0; renderPaletteOptions(); });
$("#palette-options").addEventListener("click", (event) => {
  const option = event.target.closest("[data-option-page]");
  if (option) navigate(option.dataset.optionPage);
});

$("#slash-button").addEventListener("click", () => { chatInput.value = "/"; chatInput.focus(); setSlashMenu(); });
$("#slash-menu").addEventListener("click", (event) => {
  const option = event.target.closest("[data-slash]");
  if (option) useSlash(option.dataset.slash);
});

$("#chat-form").addEventListener("submit", (event) => { event.preventDefault(); sendChat(chatInput.value); });
chatInput.addEventListener("input", () => {
  chatInput.style.height = "46px";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 130)}px`;
  setSlashMenu();
});
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#chat-form").requestSubmit(); }
  if (event.key === "Escape") $("#slash-menu").hidden = true;
  if (event.key === "ArrowDown" && !$("#slash-menu").hidden) { event.preventDefault(); $("#slash-menu button")?.focus(); }
});

document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { chatInput.value = button.dataset.prompt; chatInput.focus(); }));

$("#command-palette").addEventListener("click", (event) => { if (event.target === palette) closePalette(); });
palette.addEventListener("keydown", (event) => {
  const options = filteredOptions();
  if (event.key === "Escape") closePalette();
  if (event.key === "ArrowDown") { event.preventDefault(); selectedPaletteIndex = Math.min(options.length - 1, selectedPaletteIndex + 1); renderPaletteOptions(); }
  if (event.key === "ArrowUp") { event.preventDefault(); selectedPaletteIndex = Math.max(0, selectedPaletteIndex - 1); renderPaletteOptions(); }
  if (event.key === "Enter" && options[selectedPaletteIndex]) navigate(options[selectedPaletteIndex].id);
});

document.addEventListener("keydown", (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); return; }
  if (modifier && event.key.toLowerCase() === "j") { event.preventDefault(); chatInput.focus(); return; }
  if (modifier && /^[1-7]$/.test(event.key)) {
    event.preventDefault();
    navigate(pages[Number(event.key) - 1].id);
  }
});

refreshData();
