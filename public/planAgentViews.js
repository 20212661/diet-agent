import { esc, list, emptyState, panel, detailRows, pageIntro, stat, greeting, readableDate, goalLabel } from "./viewFormatters.js";
import { inventoryTags } from "./inventoryView.js";
import { mealRows } from "./diaryView.js";

export function modelStatusLabel(agent) {
  return ({ unconfigured: "未配置", configured_unverified: "已配置，尚未验证连接", verified: "连接验证通过", failed: "连接失败" })[agent?.status] ?? "未配置";
}

export function modelStatusHelp(agent) {
  const check = agent?.modelCheck;
  if (agent?.status === "unconfigured") return "请在 .env 中设置模型供应商和对应 API Key，保存后重启服务。";
  if (agent?.status === "configured_unverified" && check?.code === "remote_check_unavailable") return check.nextStep || "该供应商暂不支持远程认证检测；可发起一次助手请求验证。";
  if (agent?.status === "configured_unverified") return "检测到 API Key 配置。点击“验证连接”后才会检查模型服务。";
  if (agent?.status === "verified") return check?.message || "模型服务连接验证通过。";
  return check?.nextStep || check?.message || "检查 API Key、模型 ID 和网络，再重新验证；也可运行 npm run doctor。";
}

export function modelCheckButton() {
  return `<button class="secondary-button" type="button" data-check-model>验证连接</button>`;
}

export function onboardingMarkup(profile, available, weeklyPlan, userId) {
  const ackKey = `diet-agent:onboarding:no-restrictions:${userId}`;
  const planKey = `diet-agent:onboarding:first-dinner:${userId}`;
  let acknowledged = false;
  let hasFirstDinner = false;
  try { acknowledged = localStorage.getItem(ackKey) === "true"; hasFirstDinner = localStorage.getItem(planKey) === "true"; } catch {}
  const healthDone = list(profile?.allergies).length + list(profile?.avoidFoods).length > 0 || acknowledged;
  const inventoryDone = available.length > 0;
  const planDone = Boolean(weeklyPlan?.days?.length) || hasFirstDinner;
  if (healthDone && inventoryDone && planDone) return "";
  const step = (number, title, done, content) => `<div class="onboarding-step${done ? " complete" : ""}"><span class="onboarding-number">${done ? "✓" : number}</span><div><strong>${esc(title)}</strong>${content}</div></div>`;
  return `<section class="onboarding-card"><div class="eyebrow">FIRST DINNER</div><h2>开始安排第一顿晚饭</h2><p>按顺序补充信息，助手就能给出符合你情况的方案。</p><div class="onboarding-steps">${step(1, "设置过敏和忌口", healthDone, healthDone ? `<small>已记录</small>` : `<div class="onboarding-actions"><button class="text-button" data-page="profile">填写资料</button><button class="text-button" data-onboarding-ack="${esc(ackKey)}">我没有过敏或忌口</button></div>`)}${step(2, "添加现有食材", inventoryDone, inventoryDone ? `<small>${available.length} 项可用</small>` : `<button class="text-button" data-page="inventory">添加食材</button>`)}${step(3, "获取第一份晚饭方案", planDone, planDone ? `<small>${weeklyPlan?.days?.length ? "已有一周晚饭计划" : "已有一份可执行晚饭方案"}</small>` : `<button class="text-button" data-chat-prompt="根据我的过敏忌口、厨房设备和现有食材，为我安排一份今天能做的晚饭方案。如果条件不满足，请明确告诉我缺少什么。">让助手安排晚饭</button>`)}</div></section>`;
}

export function planRows(plan, limit = 7) {
  const days = list(plan?.days).slice(0, limit);
  if (!days.length) return emptyState("▦", "还没有本周菜单", "告诉饮食助手你的时间和口味，生成一周计划。", `<button class="text-button" data-chat-prompt="根据我的资料和库存安排这周的菜单">生成计划 ↗</button>`);
  return `<div class="plan-list">${days.map((day) => {
    const readiness = list(day.ingredientReadiness);
    const statusText = readiness.length
      ? readiness.map((item) => `${item.ingredient}：${item.status === "owned" ? "库存有（数量未核验）" : item.status === "already_on_list" ? "已列待购" : "待加入采购清单"}`).join(" · ")
      : day.missingIngredients?.length ? `缺少 ${day.missingIngredients.join("、")}` : "食材已备齐";
    return `<div class="plan-day${day.executionBlockedReason ? " plan-day-blocked" : ""}" role="button" tabindex="0" data-plan-day="${esc(day.date)}"><span class="plan-date">${esc(day.date?.slice(5) ?? "")}</span><div><div class="plan-name">${day.executionBlockedReason ? "需重新安排（条件已变化）" : `${esc(day.mainRecipe?.name ?? "待安排")}${day.sideRecipe?.name ? ` + ${esc(day.sideRecipe.name)}` : ""}`}</div><div class="plan-meta">${day.executionBlockedReason ? esc(day.executionBlockedReason) : `${esc(day.staplesSuggestion ?? "")}${statusText ? ` · ${esc(statusText)}` : ""}`}${day.hasDinnerLog ? " · 当天有晚餐记录" : ""}</div></div><span class="plan-state">${day.executionBlockedReason ? "不可执行" : day.completed ? "✓ 已完成" : `${Number(day.mainRecipe?.totalMinutes) || "—"} 分`}</span></div>`;
  }).join("")}</div>`;
}

export function readinessSummary(days) {
  const currentDays = list(days).filter((day) => !day.executionBlockedReason);
  const blockedCount = list(days).length - currentDays.length;
  const entries = currentDays.flatMap((day) => list(day.ingredientReadiness));
  const uniqueNames = (status) => [...new Set(entries.filter((item) => item.status === status).map((item) => item.ingredient))];
  const groups = [
    ["已列待购", uniqueNames("already_on_list")],
    ["待加入采购清单", uniqueNames("to_add_to_list")],
    ["库存有（数量未核验）", uniqueNames("owned")],
  ].filter(([, names]) => names.length);
  return groups.length
    ? groups.map(([label, names]) => `${label}：${names.join("、")}`).join("；")
    : !currentDays.length && blockedCount ? "计划菜与当前过敏、忌口或设备条件冲突，请先重新安排。"
      : blockedCount ? `可执行计划食材均已在库存中找到（数量未核验）；另有 ${blockedCount} 天需重新安排。`
        : list(days).length ? "当前菜单所需食材均可在库存中找到（数量未核验）。" : "生成计划时，助手会优先考虑库存并列出采购状态。";
}

export function renderOverviewPage(data) {
  const { profile, kitchen, inventory, today, weeklyPlan, agent } = data;
  const meals = list(today?.meals);
  const available = list(inventory?.availableIngredients).filter((item) => item.isAvailable === true);
  const completeDays = list(weeklyPlan?.days).filter((day) => day.completed).length;
  const totalCals = today?.estimatedTotalCalories;
  return `${pageIntro("PERSONAL FOOD DESK", `${greeting()}，今天想怎么吃？`, readableDate(data.date), `<button class="primary-button" data-chat-prompt="根据我的库存和厨房条件，帮我安排今天的晚饭。">✳ 让助手安排晚饭</button>`)}${onboardingMarkup(profile, available, weeklyPlan, data.userId)}
    <div class="grid stats-grid">${stat("今日记录", `${meals.length} 餐`, meals.length ? "记录会同步给饮食助手" : "还没有记录", "◷")}${stat("热量估算", totalCals !== undefined ? `${Math.round(totalCals)} kcal` : "待记录", totalCals !== undefined ? "仅统计可追溯数据" : "记录食物后显示", "⌁")}${stat("可用食材", `${available.length} 项`, available.filter((item) => item.expiresSoon).length ? `${available.filter((item) => item.expiresSoon).length} 项即将到期` : "来自你的本地库存", "▤")}${stat("周计划进度", weeklyPlan ? `${completeDays}/${weeklyPlan.days.length} 天` : "未安排", weeklyPlan ? `从 ${weeklyPlan.weekStartDate} 开始` : "可请助手规划一周", "▦")}</div>
    <div class="grid dashboard-grid"><div>${panel("今日饮食", mealRows(meals), data.date, `<button class="panel-link" data-page="diary">查看记录 →</button>`)}${panel("手边食材", inventoryTags(inventory, "availableIngredients"), `${available.length} 项可用`, `<button class="panel-link" data-page="inventory">管理库存 →</button>`)}</div><div>${panel("本周计划", planRows(weeklyPlan, 4), weeklyPlan ? `本周 · ${weeklyPlan.weekStartDate}` : "安排一周的晚餐", `<button class="panel-link" data-page="plan">查看全部 →</button>`)}${panel("模型连接", `<div class="support-copy"><strong>${esc(modelStatusLabel(agent))}</strong><p>${esc(modelStatusHelp(agent))}</p></div>`, agent.model, modelCheckButton())}</div></div>`;
}

export function renderPlanPage(data, description) {
  const { weeklyPlan } = data;
  const completeDays = list(weeklyPlan?.days).filter((day) => day.completed).length;
  const intro = pageIntro("WEEKLY MENU", "每周计划", description, `<button class="primary-button" data-chat-prompt="按我的饮食资料和现有库存，帮我重新安排这周菜单。">✳ 生成一周菜单</button>`);
  const body = `<div class="grid section-grid"><div>${panel("本周晚餐安排", planRows(weeklyPlan), weeklyPlan ? `从 ${weeklyPlan.weekStartDate} 开始 · ${completeDays}/${weeklyPlan.days.length} 天已完成` : "生成后会显示每天菜单")}</div><div>${panel("菜单状态", detailRows([["计划状态", weeklyPlan ? "进行中" : "尚未生成"], ["起始日期", esc(weeklyPlan?.weekStartDate ?? "—")], ["完成天数", weeklyPlan ? `${completeDays} 天` : "—"], ["计划天数", weeklyPlan ? `${weeklyPlan.days.length} 天` : "—"]]))}${panel("备料状态", `<div class="support-copy">${esc(readinessSummary(weeklyPlan?.days))}</div>`)}</div></div>`;
  return `${intro}${body}`;
}

export function renderAgentPage(data, description) {
  const { profile, kitchen, inventory, today, weeklyPlan, agent } = data;
  const meals = list(today?.meals);
  const available = list(inventory?.availableIngredients).filter((item) => item.isAvailable === true);
  const allInventoryItems = [...list(inventory?.availableIngredients), ...list(inventory?.shoppingList)];
  const shopping = allInventoryItems.filter((item) => item.status === "planned");
  const completeDays = list(weeklyPlan?.days).filter((day) => day.completed).length;

  const contextRows = [["用户资料", profile ? `目标 ${goalLabel(profile.goal)} · ${list(profile.avoidFoods).length} 项忌口 · ${list(profile.allergies).length} 项过敏` : "尚未设置"], ["厨房条件", `${kitchen?.burners ?? 0} 个灶眼 · 主动操作 ${kitchen?.maxActiveMinutes ?? "—"} 分钟`], ["可用库存", `${available.length} 项食材 · ${shopping.length} 项待采购`], ["今日记录", `${meals.length} 餐${today?.estimatedTotalCalories !== undefined ? ` · ${Math.round(today.estimatedTotalCalories)} kcal` : ""}`], ["每周计划", weeklyPlan ? `${weeklyPlan.days.length} 天 · ${completeDays} 天已完成` : "尚未生成"]];
  const intro = pageIntro("AGENT WORKSPACE", "智能体信息", description);
  const body = `<div class="grid section-grid"><div>${panel("运行状态", detailRows([["智能体框架", "Pi AgentSession"], ["当前模型", esc(agent.model)], ["连接状态", esc(modelStatusLabel(agent))], ["用户空间", esc(data.userId)], ["本地数据", esc(agent.dataFile)], ["对话上下文", "用户画像 + 厨房 + 库存 + 今日记录"]]), modelStatusHelp(agent), modelCheckButton())}${panel("本次对话可用的资料", detailRows(contextRows.map(([label, value]) => [label, esc(value), true])))}</div><div>${panel("智能体工具", `<div class="agent-tool-list">${list(agent.tools).map((tool) => `<div class="agent-tool"><strong>${esc(tool.label)}</strong><small>${esc(tool.description)}</small></div>`).join("")}</div>`, `${agent.tools.length} 个饮食管理工具`)}${panel("快捷键", detailRows([["打开快捷操作", "Ctrl K"], ["今日总览", "Ctrl 1"], ["我的资料", "Ctrl 2"], ["厨房设置", "Ctrl 3"], ["食材库存", "Ctrl 4"], ["饮食记录", "Ctrl 5"], ["每周计划", "Ctrl 6"], ["智能体信息", "Ctrl 7"], ["聊天输入框", "Ctrl J"]]))}</div></div>`;
  return `${intro}${body}`;
}
