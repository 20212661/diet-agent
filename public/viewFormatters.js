export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function list(values) {
  return Array.isArray(values) && values.length ? values : [];
}

export function clientOperationId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readableDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date);
}

export function mealLabel(type) {
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐", unknown: "其他" })[type] ?? type ?? "饮食";
}

export function goalLabel(goal) {
  return ({ fat_loss: "减脂", muscle_gain: "增肌", maintain: "维持体重", healthier_eating: "更健康饮食", custom: "自定义目标" })[goal] ?? goal ?? "尚未设置";
}

export function activityLabel(level) {
  return ({ low: "较少活动", medium: "中等活动", high: "高活动量" })[level] ?? "尚未设置";
}

export function emptyState(icon, title, description, action = "") {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div><strong>${esc(title)}</strong><p>${esc(description)}</p></div>${action}</div>`;
}

export function panel(title, body, subtitle = "", action = "") {
  return `<section class="panel"><div class="panel-head"><div><div class="panel-title">${esc(title)}</div>${subtitle ? `<div class="panel-subtitle">${esc(subtitle)}</div>` : ""}</div>${action}</div>${body}</section>`;
}

export function tagList(values, empty = "暂未记录") {
  const items = list(values);
  return items.length ? `<div class="tag-list">${items.map((value) => `<span class="tag">${esc(value)}</span>`).join("")}</div>` : `<span class="detail-value">${empty}</span>`;
}

export function detailRows(rows) {
  return `<div class="detail-list">${rows.map(([label, value, wrap = false]) => `<div class="detail-line"><span class="detail-label">${esc(label)}</span><span class="detail-value${wrap ? " wrap" : ""}">${value}</span></div>`).join("")}</div>`;
}

export function pageIntro(eyebrow, title, description, action = "") {
  return `<div class="page-intro"><div class="intro-row"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div></div>`;
}

export function stat(label, value, sub, icon) {
  return `<div class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`;
}

export function greeting() {
  const hour = new Date().getHours();
  return hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
}

export function formInput(label, name, value = "", type = "text", attributes = "") {
  return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${attributes}></label>`;
}

export function formSelect(label, name, value, options) {
  return `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([optionValue, optionLabel]) => `<option value="${esc(optionValue)}"${String(value ?? "") === optionValue ? " selected" : ""}>${esc(optionLabel)}</option>`).join("")}</select></label>`;
}

export function formArea(label, name, values, placeholder = "每行填写一项") {
  return `<label class="field field-wide"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="3" placeholder="${esc(placeholder)}">${esc(list(values).join("\n"))}</textarea></label>`;
}

export function splitField(value) {
  return value.split(/[\r\n,，]+/).map((item) => item.trim()).filter(Boolean);
}
