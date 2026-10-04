import { esc, list, emptyState, panel, detailRows, pageIntro, formInput, formSelect } from "./viewFormatters.js";

const storageOptions = [["", "未设置"], ["fridge", "冷藏"], ["freezer", "冷冻"], ["pantry", "储藏室"], ["room_temp", "室温"]];
const statusOptions = [["available", "可用"], ["planned", "待采购"], ["used", "已用"], ["expired", "过期"], ["discarded", "已丢弃"]];

export function inventoryItemForm(item, updatedAt, create = false) {
  const prefix = create ? "new-" : `item-${item.id}-`;
  return `<form class="editor-form inventory-item-form" data-inventory-item-form ${create ? 'data-create-item="true"' : `data-item-id="${esc(item.id)}"`} data-updated-at="${esc(updatedAt)}"><div class="form-grid">${formInput("名称", `${prefix}name`, item.name)}${formInput("数量文字", `${prefix}amount`, item.amount ?? "")}${formSelect("存放位置", `${prefix}storage`, item.storage ?? "", storageOptions)}${formInput("到期日", `${prefix}expiresAt`, item.expiresAt ?? "", "date")}${formSelect("状态", `${prefix}status`, item.status ?? "available", statusOptions)}</div><div class="form-actions"><span>${create ? "单独添加一项食材。" : "只会修改这条库存记录。"}</span><button class="primary-button" type="submit">${create ? "添加食材" : "保存修改"}</button>${create ? "" : `<button class="secondary-button" type="button" data-cancel-item-edit>取消</button>`}</div></form>`;
}

export function inventoryItemRows(items, updatedAt, editingInventoryItemId = null) {
  if (!items.length) return emptyState("▤", "暂无食材", "可通过上方表单单独添加食材。");
  return `<div class="ingredient-tags inventory-item-list">${items.map((item) => editingInventoryItemId === item.id
    ? `<div class="inventory-item-edit">${inventoryItemForm(item, updatedAt)}</div>`
    : `<div class="inventory-item-row"><span class="tag${item.expiresSoon ? " warn" : ""}"><strong>${esc(item.name)}</strong>${item.amount ? ` · ${esc(item.amount)}` : ""}${item.storage ? ` · ${esc(({ fridge: "冷藏", freezer: "冷冻", pantry: "储藏室", room_temp: "室温" })[item.storage] ?? item.storage)}` : ""}${item.expiresSoon ? " · 快过期" : ""}</span><button class="text-button" type="button" data-edit-item="${esc(item.id)}">编辑</button></div>`).join("")}</div>`;
}

export function receiptPreviewHtml(receiptDraft = []) {
  if (!receiptDraft.length) return "";
  const storageLabels = [["fridge", "冷藏"], ["freezer", "冷冻"], ["pantry", "储藏室"], ["room_temp", "室温"]];
  return `<div class="receipt-preview"><div class="receipt-preview-title">识别结果 · 可修改后再确认</div>${receiptDraft.map((item, index) => `<div class="receipt-row"><label class="receipt-check"><input type="checkbox" data-receipt-selected="${index}" checked aria-label="选择${esc(item.name)}"></label><input class="receipt-name" data-receipt-name="${index}" value="${esc(item.name)}" aria-label="食材名称"><input class="receipt-amount" data-receipt-amount="${index}" value="${esc(item.amount ?? "")}" placeholder="数量" aria-label="数量"><select data-receipt-storage="${index}" aria-label="储存位置">${storageLabels.map(([value, label]) => `<option value="${value}"${(item.storage ?? "fridge") === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>`).join("")}</div>`;
}

export function receiptImportPanel(receiptDraft = []) {
  return panel("从购物清单补充冰箱", `<div class="receipt-import">
    <label class="field"><span>上传小票或清单图片</span><input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp,.csv,.txt,text/csv,text/plain"></label>
    <div id="receipt-file-name" class="receipt-file-name">支持 JPG、PNG、WebP、CSV、TXT，或直接粘贴清单。</div>
    <label class="field"><span>也可以粘贴商品清单</span><textarea id="receipt-text" rows="4" placeholder="例如：\n番茄 | 500 克\n鸡蛋 | 1 盒\n菠菜 | 1 把"></textarea></label>
    <div class="receipt-note">图片会发送给当前配置的视觉模型识别。系统只生成待确认预览；确认前不会修改库存。</div>
    <div class="receipt-actions"><button id="receipt-recognize" class="secondary-button" type="button">识别清单</button><button id="receipt-confirm" class="primary-button" type="button" ${receiptDraft.length ? "" : "disabled"}>确认加入冰箱${receiptDraft.length ? `（${receiptDraft.length} 项）` : ""}</button></div>
    <div id="receipt-preview">${receiptPreviewHtml(receiptDraft)}</div>
  </div>`, "上传超市小票、网购清单，检查识别结果后再写入库存");
}

export function parseIngredientLines(value, existingItems) {
  const existing = list(existingItems);
  const storageValues = { "冷藏": "fridge", "冷冻": "freezer", "储藏室": "pantry", "室温": "room_temp", fridge: "fridge", freezer: "freezer", pantry: "pantry", room_temp: "room_temp" };
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [namePart, amountPart, storagePart] = line.split("|").map((part) => part.trim());
    const normalizedName = namePart.trim().toLowerCase();
    const requestedStorage = storagePart ? storageValues[storagePart] : undefined;
    const sameName = existing.filter((item) => item.name.trim().toLowerCase() === normalizedName);
    const prior = requestedStorage
      ? sameName.find((item) => item.storage === requestedStorage)
      : sameName.length === 1 ? sameName[0] : undefined;
    const storage = requestedStorage ?? prior?.storage;
    const { expiresSoon: _expiresSoon, ...previous } = prior ?? {};
    return { ...previous, name: namePart, ...(amountPart ? { amount: amountPart } : { amount: prior?.amount }), ...(storage ? { storage } : {}) };
  });
}

export function parseReceiptText(text) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { field += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (!quoted && ["|", "\t", ",", "，", ";"].includes(char)) { parts.push(field.trim()); field = ""; }
      else field += char;
    }
    parts.push(field.trim());
    return parts;
  });
  if (!rows.length) return [];
  const header = rows[0].map((part) => part.toLowerCase());
  const nameIndex = header.findIndex((part) => /商品|食材|品名|名称|product|item|name/.test(part));
  const amountIndex = header.findIndex((part) => /数量|规格|份量|amount|quantity|qty/.test(part));
  const hasHeader = nameIndex >= 0;
  return (hasHeader ? rows.slice(1) : rows).map((parts) => {
    const name = (parts[hasHeader ? nameIndex : 0] ?? "").trim();
    const amount = (parts[hasHeader ? amountIndex : 1] ?? "").trim();
    if (!name || /^(商品名称?|品名|名称|product|item|name)$/i.test(name)) return null;
    return { name: name.slice(0, 100), ...(amount ? { amount: amount.slice(0, 100) } : {}), category: "other", storage: "fridge" };
  }).filter(Boolean).slice(0, 100);
}

export function inventoryEditor(inventory) {
  const formatItems = (items) => list(items).map((item) => [item.name, item.amount, item.storage ? ({ fridge: "冷藏", freezer: "冷冻", pantry: "储藏室", room_temp: "室温" })[item.storage] ?? item.storage : ""].filter(Boolean).join(" | ")).join("\n");
  return `<details class="bulk-inventory"><summary>批量导入 / 整表编辑</summary><form class="editor-form" data-save-form="inventory" data-updated-at="${esc(inventory?.updatedAt)}"><div class="form-grid"><label class="field field-wide"><span>现有食材</span><textarea name="availableIngredients" rows="7" placeholder="每行一项，可写成：番茄 | 3个 | 冷藏">${esc(formatItems(inventory?.availableIngredients))}</textarea></label><label class="field field-wide"><span>待采购清单</span><textarea name="shoppingList" rows="5" placeholder="每行一项，可写成：鸡蛋 | 1盒 | 冷藏">${esc(formatItems(inventory?.shoppingList))}</textarea></label></div><div class="form-actions"><span>支持“名称 | 数量 | 冷藏/冷冻/储藏室/室温”。</span><button class="primary-button" type="submit">保存清单</button></div></form></details>`;
}

export function inventoryTags(inventory, kind) {
  const items = list(inventory?.[kind]).filter((item) => item.isAvailable === true);
  if (!items.length) return emptyState(kind === "shoppingList" ? "＋" : "▤", kind === "shoppingList" ? "采购清单是空的" : "库存还没有食材", kind === "shoppingList" ? "需要购买的食材会显示在这里。" : "告诉饮食助手你买了什么，它会帮你入库。");
  return `<div class="ingredient-tags">${items.map((item) => `<span class="tag${item.expiresSoon ? " warn" : ""}">${esc(item.name)}${item.amount ? ` · ${esc(item.amount)}` : ""}${item.expiresSoon ? " · 快过期" : ""}</span>`).join("")}</div>`;
}

export function renderInventoryPage(inventory, description, editingInventoryItemId = null, receiptDraft = []) {
  const allInventoryItems = [...list(inventory?.availableIngredients), ...list(inventory?.shoppingList)];
  const available = list(inventory?.availableIngredients).filter((item) => item.isAvailable === true);
  const shopping = allInventoryItems.filter((item) => item.status === "planned");
  const used = allInventoryItems.filter((item) => item.status === "used");
  const expiredDiscarded = allInventoryItems.filter((item) => item.status === "expired" || item.status === "discarded" || (item.status === "available" && item.isExpired));
  const active = allInventoryItems.filter((item) => item.isAvailable === true);

  const intro = pageIntro("YOUR PANTRY", "食材库存", description, `<button class="primary-button" data-focus-inventory-add>＋ 添加食材</button>`);
  const body = `<div class="grid section-grid"><div>${panel("可用", inventoryItemRows(active, inventory?.updatedAt, editingInventoryItemId), `${available.length} 项 · 快过期的食材会标记出来`)}${panel("待采购", inventoryItemRows(shopping, inventory?.updatedAt, editingInventoryItemId), `${shopping.length} 项待买`)}<details class="inventory-history"><summary>历史状态（${used.length + expiredDiscarded.length} 项）</summary>${panel("已用", inventoryItemRows(used, inventory?.updatedAt, editingInventoryItemId))}${panel("过期或丢弃", inventoryItemRows(expiredDiscarded, inventory?.updatedAt, editingInventoryItemId))}</details></div><div>${panel("添加食材", inventoryItemForm({ name: "", amount: "", status: "available" }, inventory?.updatedAt, true))}${panel("库存概况", detailRows([["可用食材", `${available.length} 项`], ["即将过期", `${available.filter((item) => item.expiresSoon).length} 项`], ["待采购", `${shopping.length} 项`], ["最后更新", esc(inventory?.updatedAt?.slice(0, 10) ?? "—")]]))}${panel("快捷告诉助手", `<p class="support-copy">例如：“我买了两颗番茄和一盒鸡蛋，放冰箱。”助手会整理食材名称、数量和储存位置。</p>`, "自然语言也能更新库存")}</div></div>`;
  const receiptPanel = receiptImportPanel(receiptDraft);
  const bulkEditor = panel("批量库存入口", inventoryEditor(inventory), "日常修改请使用上方逐项编辑；批量入口会替换清单");
  return `${intro}${body}${receiptPanel}${bulkEditor}`;
}
