import { esc, list, panel } from "./viewFormatters.js";
import { parseReceiptText } from "./inventoryView.js";
import { renderCartExperiments, parseCartText } from "./cartExperimentView.js";

const statusLabels = { draft: "待采购", pending: "待买", ordered: "已下单（手动记录）", in_progress: "采购中", partially_received: "部分收货", received: "已收齐", completed: "已完成", cancelled: "已取消剩余需求" };
const storageLabels = [["fridge", "冷藏"], ["freezer", "冷冻"], ["pantry", "储藏室"], ["room_temp", "室温"]];

export function createShoppingController({ root, getData, refreshData, getPendingWrite, toast }) {
  let selectedId = null, boundUser = null;
  const handoffs = new Map();
  const drafts = new Map();
  let busy = false;
  let discovery = null;
  let discoveryLink = null;
  let selectedExperimentId = null;
  const task = () => list(getData()?.shopping?.tasks).find(t => t.id === selectedId);
  const selectedRows = () => [...root.querySelectorAll("[data-shop-item]:checked")].map(input => input.value);
  const api = async (endpoint, payload, method = "POST") => {
    const pending = getPendingWrite(endpoint, payload);
    const response = await fetch(endpoint, {method, headers: {"Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId)}, body: JSON.stringify({...pending.payload, operationId: pending.operationId})});
    const result = await response.json();
    if (getData()?.userId !== pending.userId) throw new Error("用户已变化，请刷新后核对采购任务。");
    if (!response.ok) {
      if ([400, 404, 409, 422].includes(response.status)) localStorage.removeItem(pending.key);
      throw new Error(result.error || "采购操作失败。");
    }
    localStorage.removeItem(pending.key); return result;
  };
  function render(data) {
    if (boundUser !== data.userId) { boundUser = data.userId; selectedId = null; selectedExperimentId = null; discovery = null; discoveryLink = null; handoffs.clear(); drafts.clear(); }
    const tasks = list(data.shopping?.tasks), providers = list(data.shopping?.providers);
    if (discovery && Date.parse(discovery.expiresAt) <= Date.now()) { discovery = null; discoveryLink = null; }
    if (discoveryLink && Date.parse(discoveryLink.expiresAt) <= Date.now()) discoveryLink = null;
    const current = tasks.find(t => t.id === selectedId);
    const create = `<form data-shop-create class="editor-form"><div class="form-grid"><label class="field"><span>采购任务名称</span><input name="title" value="食材采购" maxlength="100" required></label><label class="field"><span>购物平台</span><select name="provider">${providers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}</select></label></div><div class="shopping-selection">${list(data.inventory?.shoppingList).map(i => `<label><input type="checkbox" name="sourceItemId" value="${esc(i.id)}"> ${esc(i.name)} <input data-shop-create-amount="${esc(i.id)}" value="${esc(i.amount ?? "")}" maxlength="200" placeholder="数量待确认" aria-label="${esc(i.name)}采购数量"></label>`).join("") || '<p class="support-copy">先在待采购清单中添加食材，也可从周计划缺料加入。</p>'}</div><label class="support-copy"><input name="allowDuplicate" type="checkbox"> 明确创建额外采购（允许与未完成任务重复）</label><div class="form-actions"><button class="primary-button" type="submit" ${data.inventory?.shoppingList?.length ? "" : "disabled"}>创建采购任务</button></div></form>`;
    const settings = `<details><summary>配置美团 / 淘宝闪购购物入口</summary><p class="support-copy">粘贴你在平台获得的官方 HTTPS 链接，先用自己的设备测试。保存后会标为“用户已验证”，不代表平台 API 已开通。可清空链接停用。</p>${providers.map(p => `<form data-shop-provider="${esc(p.id)}" class="editor-form"><label class="field"><span>${esc(p.label)} · ${p.entryUrl ? "用户已验证" : "待配置"}</span><input name="url" value="${esc(p.entryUrl)}" maxlength="2000" placeholder="https://…"></label><label class="support-copy"><input type="checkbox" name="verified"> 我已在实际购物设备上打开并确认入口可用</label><div class="form-actions"><button class="secondary-button" type="submit">保存入口</button></div></form>`).join("")}</details>`;
    const summary = `<div class="shopping-task-list">${tasks.map(t => `<button type="button" class="secondary-button" data-shop-open="${esc(t.id)}">${esc(t.title)} · ${esc(statusLabels[t.status])} · ${esc(t.createdAt.slice(0,10))}</button>`).join("") || '<p class="support-copy">暂无采购任务。</p>'}</div>${tasks.length >= 50 ? '<p class="support-copy">显示最近 50 个任务。</p>' : ""}`;
    let detail = "";
    if (current) {
      const handoff = handoffs.get(current.id), preview = drafts.get(current.id);
      const provider = providers.find(p => p.id === current.provider);
      const active = current.items.filter(i => !["received", "cancelled"].includes(i.status));
      detail = panel(current.title, `<p class="support-copy">${esc(provider?.label)} · ${esc(statusLabels[current.status])}。打开平台不会自动下单，已下单状态由你记录。</p><div class="shopping-selection">${current.items.map(i => `<label><input data-shop-item type="checkbox" value="${esc(i.id)}" ${["received","cancelled"].includes(i.status) ? "disabled" : ""}> ${esc(i.name)} · ${esc(i.amount || "数量待确认")} · ${esc(statusLabels[i.status])}${i.status === "pending" ? `<button class="text-button" type="button" data-shop-edit="${esc(i.id)}">改数量</button>` : ""}</label>`).join("")}</div><div class="receipt-actions"><button class="secondary-button" data-shop-copy type="button">复制未完成清单</button><button class="primary-button" data-shop-handoff type="button" ${provider?.entryUrl ? "" : "disabled"}>准备购买入口 / 二维码</button><button class="secondary-button" data-shop-action="mark-ordered" type="button">所选项已下单</button><button class="secondary-button" data-shop-action="cancel-items" type="button">取消所选剩余需求</button></div>${!provider?.entryUrl ? '<p class="support-copy">这个平台尚未配置入口，你仍可以复制清单自行购买。</p>' : ""}${handoff && handoff.url === provider?.entryUrl ? `<div class="shopping-handoff"><img src="${esc(handoff.qr)}" alt="手机扫码打开购物平台" width="256" height="256"><div><a class="primary-button" href="${esc(handoff.url)}" target="_blank" rel="noopener noreferrer">打开购物平台</a><p class="support-copy">手机扫码只打开平台，清单请对照电脑或截图。入口由用户验证；失效时重新配置。</p></div></div>` : ""}
      ${active.length ? `<form data-shop-receive class="editor-form"><h3>核对实际收货</h3><p class="support-copy">默认新增独立库存批次。少送或尚未买齐时取消“已收齐”；勾选“已收齐”代表你确认本项采购需求已满足。</p><label class="field"><span>小票 / 商品清单图片（会发送给当前视觉模型）</span><input data-shop-receipt-file type="file" accept="image/jpeg,image/png,image/webp,.txt,.csv"></label><label class="field"><span>或粘贴实收清单</span><textarea data-shop-receipt-text rows="3" placeholder="番茄 | 500 克"></textarea></label><button class="secondary-button" data-shop-parse type="button">识别并预填，随后核对</button>${preview ? `<div class="support-copy">识别结果：${preview.map(p => `${esc(p.name)} ${esc(p.amount ?? "")}`).join("；")}。仅同名项自动预填，替代品请手动填写到对应需求。</div>` : ""}${active.map(i => {
        const matched = preview?.find(p => p.name === i.name);
        return `<fieldset class="shopping-receive-row" data-shop-receive-row="${esc(i.id)}"><legend>${esc(i.name)} · 需求 ${esc(i.amount || "待确认")}</legend><label><input name="receive" type="checkbox" ${matched ? "checked" : ""}> 本次收到</label><div class="form-grid"><label class="field"><span>实收名称（可填替代品）</span><input name="name" value="${esc(matched?.name ?? i.name)}" maxlength="100"></label><label class="field"><span>本次实收数量</span><input name="amount" value="${esc(matched?.amount ?? "")}" maxlength="200" placeholder="按实收填写，不推测"></label><label class="field"><span>储存位置</span><select name="storage">${storageLabels.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select></label><label class="field"><span>库存处理</span><select name="mergeTargetId"><option value="">新增独立批次</option>${list(data.inventory?.availableIngredients).filter(x => x.isAvailable).map(x => `<option value="${esc(x.id)}">合并：${esc(x.name)} ${esc(x.amount || "未知数量")} · ${esc(storageLabels.find(([v]) => v === x.storage)?.[1] ?? "未设置位置")}</option>`).join("")}</select></label><label class="field"><span>手动核对的合并总数量（单位不明时必填）</span><input name="mergedAmount" maxlength="200" placeholder="留空则仅在单位明确时自动相加"></label></div><label><input name="complete" type="checkbox"> 此项采购需求已收齐</label></fieldset>`;
      }).join("")}<label class="support-copy"><input name="confirmDuplicate" type="checkbox"> 相同内容确实是第二次收货（仅在重复提示后使用）</label><div class="form-actions"><button class="primary-button" type="submit">确认所选实收项入库</button></div></form>` : '<p class="support-copy">本任务已终结，库存中的食材可继续编辑、标记用完或丢弃。</p>'}`);
    }
    if (current?.receiptHistory?.length) {
      detail += panel("收货记录", current.receiptHistory.map(r => `<div class="shopping-receive-row"><strong>${esc(new Date(r.createdAt).toLocaleString("zh-CN"))} · 用户确认</strong><p>${r.items.map(i => `${esc(i.name)} ${esc(i.amount || "数量未填写")} · ${i.complete ? "本项已收齐" : "部分收货"}${i.mergeTargetId ? " · 合并库存" : " · 独立批次"}`).join("<br>")}</p></div>`).join(""));
    }
    const taobao = providers.find(p => p.id === "taobao")?.officialApi;
    const apiLabels = {unconfigured: "待配置联盟凭证", pending_verification: "已配置，待实际查询验证", verified: "查询接口已验证（24 小时内）", failed: "最近查询失败，可重试", pending_official_sdk: "待官方 SDK 和权限核验"};
    const official = `<p class="support-copy">${providers.map(p => `${esc(p.label)}：${esc(apiLabels[p.officialApi?.status] || "待配置")} · ${esc(p.officialApi?.scope || "")}`).join("<br>")}</p><form data-shop-search class="editor-form"><div class="form-grid"><label class="field"><span>淘宝闪购门店名称关键词</span><input name="keyword" required maxlength="100" placeholder="例如：附近超市品牌名称"></label><label class="field"><span>配送位置经度（GCJ-02）</span><input name="longitude" required inputmode="decimal" placeholder="在地图中核对后填写"></label><label class="field"><span>配送位置纬度（GCJ-02）</span><input name="latitude" required inputmode="decimal" placeholder="最多 6 位小数"></label></div><label class="support-copy"><input name="locationConsent" type="checkbox" required> 我确认向淘宝闪购发送本次经纬度以查询附近门店；本应用不保存该位置</label><p class="support-copy">联盟结果可能包含餐饮门店，不保证覆盖生鲜。请在平台核对所需食材、规格、库存和配送范围。购买链接可能含推广归因。</p><button class="secondary-button" type="submit" ${taobao?.configured ? "" : "disabled"}>查询附近门店</button>${!taobao?.configured ? '<p class="support-copy">参照项目 .env.example 填写联盟凭证和 PID，重启服务后可查询。</p>' : ""}</form>${discovery ? `<p class="support-copy">${esc(discovery.scope)} · 查询时间 ${esc(new Date(discovery.fetchedAt).toLocaleString("zh-CN"))} · 结果 5 分钟内有效</p>${list(discovery.candidates).map(c => `<div class="shopping-receive-row"><strong>${esc(c.title)}</strong><p>${esc(c.category || "类目待核对")} · 起送 ${c.minimumOrderCents == null ? "待核对" : `${(c.minimumOrderCents / 100).toFixed(2)} 元`} · 配送费 ${c.deliveryFeeCents == null ? "待核对" : `${(c.deliveryFeeCents / 100).toFixed(2)} 元`}</p><p class="support-copy">${list(c.items).map(i => `${esc(i.title)} ${i.priceCents == null ? "价格待核对" : `${(i.priceCents / 100).toFixed(2)} 元`} · 规格待核对`).join("；") || "商品需进入门店核对"}</p><button class="secondary-button" type="button" data-shop-official-link="${esc(c.id)}">获取此门店购买链接</button></div>`).join("") || '<p class="support-copy">本次没有找到门店，可更换门店关键词或使用手动入口。</p>'}` : ""}${discoveryLink ? `<div class="shopping-handoff"><img src="${esc(discoveryLink.qr)}" alt="官方门店购买链接二维码" width="256" height="256"><div><a class="primary-button" href="${esc(discoveryLink.url)}" target="_blank" rel="noopener noreferrer">打开所选门店</a><p class="support-copy">取链时间 ${esc(new Date(discoveryLink.fetchedAt).toLocaleString("zh-CN"))} · 页面展示至 ${esc(new Date(discoveryLink.expiresAt).toLocaleTimeString("zh-CN"))}。扫码后由你核对清单和结算，跳转不改变采购状态。</p></div></div>` : ""}`;
    return `<div id="shopping-workspace">${panel("在线采购", create, "创建清单 → 平台购买 → 收货入库")}${panel("官方门店查询", official)}${panel("平台入口", settings)}${panel("采购任务", summary)}${detail}${renderCartExperiments(data,current,selectedExperimentId)}</div>`;
  }
  function rerender() {
    const area = root.querySelector("#shopping-workspace");
    if (area) area.outerHTML = render(getData());
  }
  async function run(action, button) {
    if (busy) return;
    busy = true; if (button) button.disabled = true;
    try { await action(); } catch (error) { toast(error.message || "采购操作失败。"); }
    finally { busy = false; if (button?.isConnected) button.disabled = false; }
  }
  async function officialRequest(action, payload) {
    const userId = getData().userId;
    const response = await fetch(`/api/shopping/providers/taobao/${action}`, {method: "POST", headers: {"Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(userId)}, body: JSON.stringify(payload)});
    const result = await response.json();
    if (getData().userId !== userId) throw new Error("用户已变化，请重新查询门店。");
    if (!response.ok) throw new Error(result.error || "平台查询失败，可使用手动入口。");
    return result;
  }
  root.addEventListener("submit", event => {
    const form = event.target;
    if (form.matches("[data-cart-create],[data-cart-action]")) {
      event.preventDefault();
      run(async () => {
        const fields = new FormData(form), current = task();
        if (!current) throw new Error("请先选择采购任务。");
        let endpoint = "/api/shopping/cart-experiments", payload;
        if (form.matches("[data-cart-create]")) {
          const budget = fields.get("budget");
          payload = {taskId:current.id,expectedTaskVersion:current.version,itemIds:fields.getAll("itemId"),phoneOS:fields.get("phoneOS"),store:fields.get("store"),accountLabel:fields.get("accountLabel"),budgetCents:budget ? Math.round(Number(budget) * 100) : null};
        } else {
          const id = form.dataset.cartId, experiment = list(getData().shopping?.cartExperiments).find(e => e.id === id);
          if (!experiment) throw new Error("实验已变化，请刷新。");
          const action = form.dataset.cartAction;
          endpoint += `/${id}/${action}`;
          payload = {expectedVersion:experiment.version,contextConfirmed:fields.has("contextConfirmed"),completeCartConfirmed:fields.has("completeCartConfirmed"),stepId:fields.get("stepId")};
          if (["baseline","begin-step","reconcile"].includes(action)) payload.cart = parseCartText(fields.get("cart"));
          if (action === "select") Object.assign(payload,{itemId:fields.get("itemId"),store:experiment.store,title:fields.get("title"),specification:fields.get("specification"),quantity:Number(fields.get("quantity")),priceCents:fields.get("price") ? Math.round(Number(fields.get("price")) * 100) : null,specificationConfirmed:fields.has("specificationConfirmed"),availableConfirmed:fields.has("availableConfirmed")});
        }
        selectedExperimentId = (await api(endpoint,payload)).experiment.id;
        await refreshData(); toast("手机实验记录已保存；未操作手机购物车。");
      },form.querySelector('[type="submit"]'));
      return;
    }
    if (!form.matches("[data-shop-create],[data-shop-provider],[data-shop-receive],[data-shop-search]")) return;
    event.preventDefault();
    run(async () => {
      const fields = new FormData(form);
      if (form.matches("[data-shop-search]")) {
        discovery = null; discoveryLink = null;
        try { discovery = await officialRequest("search", {keyword: fields.get("keyword"), longitude: String(fields.get("longitude")).trim(), latitude: String(fields.get("latitude")).trim(), locationConsent: fields.has("locationConsent")}); setTimeout(rerender, Math.max(0, Date.parse(discovery.expiresAt) - Date.now()) + 10); }
        finally { await refreshData(); }
        return;
      }
      if (form.matches("[data-shop-create]")) {
        const items = fields.getAll("sourceItemId").map(id => ({sourceItemId: id, amount: [...form.querySelectorAll("[data-shop-create-amount]")].find(el => el.dataset.shopCreateAmount === id)?.value ?? ""}));
        const result = await api("/api/shopping/tasks", {title: fields.get("title"), provider: fields.get("provider"), items, inventoryUpdatedAt: getData().inventory.updatedAt, allowDuplicate: fields.has("allowDuplicate")});
        selectedId = result.task.id;
      } else if (form.matches("[data-shop-provider]")) {
        await api(`/api/shopping/provider-settings/${form.dataset.shopProvider}`, {url: String(fields.get("url")).trim(), verified: fields.has("verified")});
        handoffs.clear();
      } else {
        const current = task();
        if (!current) throw new Error("任务已变化，请刷新。");
        const items = [...form.querySelectorAll("[data-shop-receive-row]")].filter(row => row.querySelector('[name="receive"]').checked).map(row => {
          const field = name => row.querySelector(`[name="${name}"]`);
          return {itemId: row.dataset.shopReceiveRow, name: field("name").value, amount: field("amount").value, storage: field("storage").value, complete: field("complete").checked, mergeTargetId: field("mergeTargetId").value, mergedAmount: field("mergedAmount").value};
        });
        if (!items.length) throw new Error("请勾选本次收到的食材。");
        await api(`/api/shopping/tasks/${current.id}/receive`, {items, expectedVersion: current.version, inventoryUpdatedAt: getData().inventory.updatedAt, confirmDuplicate: fields.has("confirmDuplicate")});
        drafts.delete(current.id);
      }
      await refreshData(); toast("采购信息已保存。");
    }, form.querySelector('[type="submit"]'));
  });
  root.addEventListener("click", event => {
    const experimentButton = event.target.closest("[data-cart-open],[data-cart-cancel]");
    if (experimentButton) {
      if (experimentButton.dataset.cartOpen) {selectedExperimentId = experimentButton.dataset.cartOpen; rerender();}
      else run(async () => {
        const id = experimentButton.dataset.cartCancel, experiment = list(getData().shopping?.cartExperiments).find(e => e.id === id);
        if (!experiment) throw new Error("实验已变化，请刷新。");
        await api(`/api/shopping/cart-experiments/${id}/cancel`,{expectedVersion:experiment.version});
        await refreshData(); toast("本地实验已结束，请本人核对手机购物车。");
      },experimentButton);
      return;
    }
    const officialButton = event.target.closest("[data-shop-official-link]");
    if (officialButton) {
      run(async () => {
        discoveryLink = null;
        try { discoveryLink = await officialRequest("purchase-link", {candidateId: officialButton.dataset.shopOfficialLink}); setTimeout(rerender, Math.max(0, Date.parse(discoveryLink.expiresAt) - Date.now()) + 10); }
        finally { await refreshData(); }
      }, officialButton);
      return;
    }
    const button = event.target.closest("button");
    if (button?.hasAttribute("data-shop-focus")) { root.querySelector("#shopping-workspace")?.scrollIntoView({behavior:"smooth",block:"start"}); return; }
    if (!button || !button.closest("#shopping-workspace")) return;
    if (button.dataset.shopOpen) { selectedId = button.dataset.shopOpen; rerender(); return; }
    if (!button.matches("[data-shop-copy],[data-shop-handoff],[data-shop-action],[data-shop-parse],[data-shop-edit]")) return;
    run(async () => {
      const current = task(); if (!current) throw new Error("请选择采购任务。");
      if (button.hasAttribute("data-shop-copy")) {
        await navigator.clipboard.writeText(current.items.filter(i => !["received","cancelled"].includes(i.status)).map(i => `${i.name} | ${i.amount || "数量待确认"}`).join("\n")); toast("清单已复制。"); return;
      }
      if (button.hasAttribute("data-shop-handoff")) {
        handoffs.set(current.id, await api(`/api/shopping/tasks/${current.id}/handoffs`, {})); rerender(); return;
      }
      if (button.dataset.shopAction) {
        const itemIds = selectedRows(); if (!itemIds.length) throw new Error("请先勾选任务条目。");
        if (button.dataset.shopAction === "cancel-items" && !window.confirm("取消所选未收货需求？已经入库的食材会保留。")) return;
        await api(`/api/shopping/tasks/${current.id}/${button.dataset.shopAction}`, {itemIds, expectedVersion: current.version});
        await refreshData(); return;
      }
      if (button.dataset.shopEdit) {
        const item = current.items.find(i => i.id === button.dataset.shopEdit);
        const amount = window.prompt("修改采购数量，留空表示待确认", item.amount ?? "");
        if (amount === null) return;
        await api(`/api/shopping/tasks/${current.id}/items/${item.id}`, {amount, expectedVersion: current.version}, "PATCH"); await refreshData(); return;
      }
      const file = root.querySelector("[data-shop-receipt-file]")?.files?.[0];
      let items;
      if (file?.type.startsWith("image/")) {
        if (file.size > 4_500_000) throw new Error("图片不能超过 4.5 MB。");
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("图片读取失败。")); reader.readAsDataURL(file); });
        const response = await fetch(`/api/shopping/tasks/${current.id}/receipt-preview`, {method: "POST", headers: {"Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(getData().userId)}, body: JSON.stringify({data, mimeType: file.type})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "识别失败。"); items = result.items;
      } else {
        if (file && file.size > 100_000) throw new Error("文字清单不能超过 100 KB。");
        items = parseReceiptText(file ? await file.text() : root.querySelector("[data-shop-receipt-text]").value);
      }
      if (!items?.length) throw new Error("未识别到食材，可直接手动填写实收信息。");
      drafts.set(current.id, items); rerender(); toast("请核对预填信息，再确认入库。");
    }, button);
  });
  return {render};
}
