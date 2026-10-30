import { esc, list, panel } from "./viewFormatters.js";

const labels = {awaiting_baseline:"待核对原购物车",selecting:"待搜索并核对商品",ready_to_add:"可登记下一步",awaiting_reconciliation:"等待手机加购结果核对",needs_review:"停止，需本人核对",review_ready:"购物车记录核对完成，待本人审阅",cancelled:"本地实验已结束"};
const money = cents => cents == null ? "价格待核对" : `${(cents / 100).toFixed(2)} 元`;
export function parseCartText(value) {
  return String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line,index) => {
    const fields = line.split("|").map(field => field.trim());
    if (fields.length !== 5 || !/^\d+$/.test(fields[3]) || (fields[4] !== "?" && !/^\d+(\.\d{1,2})?$/.test(fields[4]))) throw new Error(`第 ${index + 1} 行格式应为：门店 | 商品 | 规格 | 件数 | 单价元；未知价格填 ?。`);
    return {store:fields[0],title:fields[1],specification:fields[2],quantity:Number(fields[3]),priceCents:fields[4] === "?" ? null : Math.round(Number(fields[4]) * 100)};
  });
}
function cartText(rows) { return list(rows).map(r => `${r.store} | ${r.title} | ${r.specification} | ${r.quantity} | ${r.priceCents == null ? "?" : (r.priceCents / 100).toFixed(2)}`).join("\n"); }
export function renderCartExperiments(data, task, selectedId) {
  const guide = '<p class="support-copy">第三阶段 · 淘宝闪购手机实验。当前由你在手机搜索和加购，本页只保存手动核对记录，尚未连接手机自动控制。全程停止在购物车审阅，不自动结算、付款或清空购物车。</p>';
  if (!task || task.provider !== "taobao") return panel("手机选购实验",guide+'<p class="support-copy">先选择一个淘宝闪购采购任务；真实验收需覆盖 3 类食材。</p>');
  const experiments = list(data.shopping?.cartExperiments).filter(e => e.taskId === task.id);
  const current = experiments.find(e => e.id === selectedId) ?? experiments[0];
  const pending = task.items.filter(i => i.status === "pending");
  const open = experiments.some(e => !["cancelled","review_ready"].includes(e.status));
  const create = !open && pending.length ? `<form data-cart-create class="editor-form"><div class="form-grid"><label class="field"><span>手机系统</span><select name="phoneOS" required><option value="">请选择</option><option value="android">Android</option><option value="ios">iOS</option></select></label><label class="field"><span>账号代号（不要填手机号）</span><input name="accountLabel" value="账号 A" required maxlength="50"></label><label class="field"><span>目标门店名称</span><input name="store" required maxlength="100"></label><label class="field"><span>本轮新增商品预算（元，可留空）</span><input name="budget" type="number" min="0.01" step="0.01"></label></div><p class="support-copy">选 1–3 个条目进行实验。先在手机确认账号、门店及配送区域，不在本页填写地址。</p>${pending.map((i,index) => `<label class="support-copy"><input type="checkbox" name="itemId" value="${esc(i.id)}" ${index < 3 ? "checked" : ""}> ${esc(i.name)} · ${esc(i.amount || "数量待确认")}</label>`).join("")}<button class="secondary-button" type="submit">创建手机实验记录</button></form>` : "";
  const history = experiments.map(e => `<button type="button" class="text-button" data-cart-open="${esc(e.id)}">${esc(labels[e.status])} · ${esc(new Date(e.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}))}</button>`).join("");
  if (!current) return panel("手机选购实验",guide+create+history);
  const context = '<label class="support-copy"><input name="contextConfirmed" type="checkbox" required> 我已确认手机仍为同一账号、门店及配送区域</label>';
  const snapshot = (value, description) => `<label class="field"><span>${description}（每行：门店 | 商品 | 规格 | 件数 | 单价元）</span><textarea name="cart" rows="5" placeholder="超市 A | 鸡蛋 | 10 枚/盒 | 1 | 9.90">${esc(cartText(value))}</textarea></label><label class="support-copy"><input name="completeCartConfirmed" type="checkbox" required> 我已完整核对手机全部门店购物车；空白代表已确认空车，不是未读取</label>`;
  const form = (action, body, button) => `<form data-cart-action="${action}" data-cart-id="${esc(current.id)}" class="editor-form">${body}${context}<button class="secondary-button" type="submit">${button}</button></form>`;
  let action = "";
  if (current.status === "awaiting_baseline") action = form("baseline",snapshot([],"原购物车；逐行记录已有商品"),"确认原购物车记录");
  if (current.status === "selecting") {
    const selections = current.itemIds.map(id => task.items.find(i => i.id === id)).filter(Boolean);
    action = form("select",`<p class="support-copy">在手机逐项搜索。名称相似不代表规格相同；核对重量/件数、鲜冻、包装和可售状态。件数是本轮希望购物车中存在的总件数，已有足量时不再加购。</p><div class="form-grid"><label class="field"><span>采购需求</span><select name="itemId">${selections.map(i => `<option value="${esc(i.id)}">${esc(i.name)} ${esc(i.amount || "")}</option>`).join("")}</select></label><label class="field"><span>手机显示的完整商品名称</span><input name="title" required maxlength="150"></label><label class="field"><span>完整规格</span><input name="specification" required maxlength="150" placeholder="例如 500 克/份（按实际页面填写）"></label><label class="field"><span>购物车目标总件数</span><input name="quantity" type="number" min="1" max="100" value="1" required></label><label class="field"><span>单件价格（元，未知留空）</span><input name="price" type="number" min="0" step="0.01"></label></div><label class="support-copy"><input name="specificationConfirmed" type="checkbox" required> 商品与需求、规格相符，我已在手机核对</label><label class="support-copy"><input name="availableConfirmed" type="checkbox" required> 当前可售且配送范围可用，我已在手机核对</label>`,"保存本项选择") + form("prepare","<p class=\"support-copy\">所有选定需求都有已核对的商品后，生成本轮补购步骤。</p>","计算需要新增的件数");
  }
  const next = current.steps.find(s => s.status === "pending");
  if (current.status === "ready_to_add" && next) action = form("begin-step",`<input type="hidden" name="stepId" value="${esc(next.id)}"><p>下一项：${esc(next.product.title)} · ${esc(next.product.specification)} · 只新增 ${next.addQuantity} 件。</p>${snapshot(current.latestCart,"先在手机重新核对加购前购物车，只有仍一致才继续")}`,"先登记本步骤，再在手机加购");
  const unresolved = current.steps.find(s => ["awaiting_reconciliation","unknown"].includes(s.status));
  if (unresolved) action = form("reconcile",`<input type="hidden" name="stepId" value="${esc(unresolved.id)}"><p>已登记：${esc(unresolved.product.title)} · ${esc(unresolved.product.specification)}，计划新增 ${unresolved.addQuantity} 件。若已点击但结果不明，请先查看购物车，避免重复加购。</p>${snapshot(current.latestCart,"手机操作后，按实际结果更新完整购物车")}`,"记录实际购物车并比较差异") + (unresolved.status !== "unknown" ? form("unknown",`<input type="hidden" name="stepId" value="${esc(unresolved.id)}">`,"结果不明，停止并核对") : "");
  const selections = current.selections.map(s => `<li>${esc(s.title)} · ${esc(s.specification)} · 目标 ${s.quantity} 件 · ${esc(money(s.priceCents))}</li>`).join("");
  const steps = current.steps.map(s => `<li>${esc(s.product.title)}：新增 ${s.addQuantity} 件 · ${esc({pending:"尚未登记",awaiting_reconciliation:"已登记，待手机结果核对",confirmed:"用户记录已核对",unknown:"结果不明，禁止重试",mismatch:"差异异常，需人工核对"}[s.status])}</li>`).join("");
  const snapshotList = rows => `<ul>${list(rows).map(r => `<li>${esc(r.store)} · ${esc(r.title)} · ${esc(r.specification)} · ${r.quantity} 件 · 单价 ${esc(money(r.priceCents))}</li>`).join("") || "<li>用户已确认空购物车</li>"}</ul>`;
  const recordedCart = current.baseline ? `<details><summary>原购物车记录（全部门店）</summary>${snapshotList(current.baseline)}</details><details ${current.status === "review_ready" ? "open" : ""}><summary>最近购物车记录（全部门店，用户确认）</summary>${snapshotList(current.latestCart)}</details>` : "";
  const review = current.status === "review_ready" ? '<p class="support-copy">记录已核对。请本人在手机审阅全部购物车、地址、规格、金额及配送，再决定是否购买。实际购买后仍需手动记录已下单；当前任务和库存未因实验而变化。</p>' : "";
  const cancel = current.status !== "cancelled" ? `<button type="button" class="text-button" data-cart-cancel="${esc(current.id)}">结束本地实验（不修改手机购物车）</button>` : "";
  return panel("手机选购实验",guide+create+history+`<h3>${esc(labels[current.status])}</h3><p class="support-copy">${esc(current.accountLabel)} · ${esc(current.store)} · ${esc(current.phoneOS)} · 数据来源：用户手动确认。闲置超过 30 分钟需重新创建。</p>${current.issues.map(i => `<p class="support-copy">${esc(i)}</p>`).join("")}<ul>${selections}</ul><ul>${steps}</ul>${current.estimatedAddedCents != null ? `<p>预计新增商品金额：${esc(money(current.estimatedAddedCents))}（不含配送与优惠）</p>` : ""}${recordedCart}${action}${review}${cancel}`);
}
