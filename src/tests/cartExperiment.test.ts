import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import type {CartExperiment,CartRow} from "../shopping/cartExperiment.js";
process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const shopping = await import("../shopping/shoppingService.js");
const cart = await import("../shopping/cartExperiment.js");
const {executeWebWriteOnce} = await import("../web/writeOnce.js");
const {getDatabase} = await import("../store/database.js");
const privacy = await import("../privacy/userData.js");
const user = "cart-experiment-tests";
beforeEach(() => store.closeDatabase());
afterEach(() => {vi.restoreAllMocks();store.closeDatabase();});
function setup() {
  const inventory = store.upsertIngredientInventory(user,{shoppingList:["番茄","鸡蛋","牛奶"].map(name => ({name,amount:"1 份",status:"planned" as const}))});
  const task = shopping.createShoppingTask(user,{provider:"taobao",inventoryUpdatedAt:inventory.updatedAt,items:inventory.shoppingList.map(i => ({sourceItemId:i.id}))});
  const exp = cart.createCartExperiment(user,{taskId:task.id,expectedTaskVersion:task.version,itemIds:task.items.map(i => i.id),phoneOS:"android",store:"超市 A",accountLabel:"账号 A"});
  return {inventory,task,exp};
}
function change(exp: CartExperiment, action: string, extra = {}) {
  return cart.changeCartExperiment(user,exp.id,action,{expectedVersion:exp.version,contextConfirmed:true,completeCartConfirmed:true,...extra});
}
function selected(exp: CartExperiment, task: ReturnType<typeof shopping.getShoppingTask>, baseline: CartRow[] = [], quantity = 1) {
  exp = change(exp,"baseline",{cart:baseline});
  for (const item of task.items) exp = change(exp,"select",{itemId:item.id,store:"超市 A",title:item.name,specification:"1 份",quantity,priceCents:500,specificationConfirmed:true,availableConfirmed:true});
  return change(exp,"prepare");
}
describe("第三阶段手机实验的购物车一致性", () => {
  it("三类食材逐项登记、比较差异并停在审阅，采购状态及库存不变", () => {
    const {task,inventory,exp:created} = setup(); let exp = selected(created,task), actual: CartRow[] = [];
    expect(exp.mode).toBe("phone_assisted"); expect(exp.evidenceSource).toBe("user_confirmed");
    expect(exp.estimatedAddedCents).toBe(1500);
    for (let i=0;i<3;i++) {
      const step = exp.steps.find(s => s.status === "pending")!;
      exp = change(exp,"begin-step",{stepId:step.id,cart:actual});
      expect(exp.status).toBe("awaiting_reconciliation");
      actual = [...actual,{...step.product,quantity:step.addQuantity}];
      exp = change(exp,"reconcile",{stepId:step.id,cart:actual});
    }
    expect(exp.status).toBe("review_ready");
    expect(shopping.getShoppingTask(user,task.id).version).toBe(task.version);
    expect(store.getIngredientInventory(user)).toEqual(inventory);
    expect(() => change(exp,"prepare")).toThrow("已结束");
  });
  it("保留原购物车，已有商品只补到目标总件数，足量不再加购", () => {
    const {task,exp:created} = setup();
    const original = [{store:"超市 A",title:"番茄",specification:"1 份",quantity:1,priceCents:500},{store:"其他门店",title:"面包",specification:"1 袋",quantity:2,priceCents:600}];
    const exp = selected(created,task,original,2);
    expect(exp.steps.map(s => s.addQuantity)).toEqual([1,2,2]);
    expect(exp.baseline).toEqual(original); expect(exp.latestCart).toEqual(original);
    const step = exp.steps[0]; let active = change(exp,"begin-step",{stepId:step.id,cart:original});
    active = change(active,"reconcile",{stepId:step.id,cart:[{...original[0],quantity:2},original[1]]});
    expect(active.status).toBe("ready_to_add");
    expect(active.latestCart![1]).toEqual(original[1]);
    expect(cart.cartDiff(original,active.latestCart!)[0].delta).toBe(1);
  });
  it("结果未知时禁止重复登记，之后只能通过实际购物车核对解锁", () => {
    const {task,exp:created} = setup(); let exp = selected(created,task), step = exp.steps[0];
    exp = change(exp,"begin-step",{stepId:step.id,cart:[]});
    expect(() => change(exp,"begin-step",{stepId:step.id,cart:[]})).toThrow("不能重复");
    exp = change(exp,"unknown",{stepId:step.id}); expect(exp.status).toBe("needs_review");
    expect(() => change(exp,"begin-step",{stepId:step.id,cart:[]})).toThrow("不能重复");
    exp = change(exp,"reconcile",{stepId:step.id,cart:[step.product]});
    expect(exp.status).toBe("ready_to_add"); expect(exp.steps[0].status).toBe("confirmed");
  });
  it("已有商品移除、误加、加购件数异常和单价变化均停止后续步骤", () => {
    for (const kind of ["removed","extra","wrong_quantity","price"]) {
      store.closeDatabase(); const {task,exp:created} = setup();
      const old = {store:"其他门店",title:"面包",specification:"1 袋",quantity:1,priceCents:900};
      let exp = selected(created,task,[old]), step = exp.steps[0];
      exp = change(exp,"begin-step",{stepId:step.id,cart:[old]});
      const actual = {...step.product,quantity:kind === "wrong_quantity" ? 2 : 1,priceCents:kind === "price" ? 999 : 500};
      const after = kind === "removed" ? [actual] : kind === "extra" ? [old,actual,{...old,title:"误加饼干"}] : [old,actual];
      exp = change(exp,"reconcile",{stepId:step.id,cart:after});
      expect(exp.status).toBe("needs_review"); expect(exp.steps[0].status).toBe("mismatch");
      expect(() => change(exp,"begin-step",{stepId:exp.steps[1].id,cart:after})).toThrow("不能重复");
    }
  });
  it("加购前发现购物车变化就不登记，未确认规格/库存/账号则拒绝", () => {
    const {task,exp:created} = setup();
    expect(() => change(created,"baseline",{cart:[],completeCartConfirmed:false})).toThrow("完整核对");
    const baseline = change(created,"baseline",{cart:[]});
    expect(() => change(baseline,"select",{itemId:task.items[0].id,specificationConfirmed:false})).toThrow("商品规格");
    expect(() => change(baseline,"prepare",{contextConfirmed:false})).toThrow("同一账号");
    let exp = baseline;
    for (const item of task.items) exp = change(exp,"select",{itemId:item.id,store:"超市 A",title:item.name,specification:"1 份",quantity:1,priceCents:500,specificationConfirmed:true,availableConfirmed:true});
    exp = change(exp,"prepare");
    expect(() => change(exp,"begin-step",{stepId:exp.steps[0].id,cart:[exp.steps[1].product]})).toThrow("最近记录不一致");
    expect(cart.getCartExperiment(user,exp.id).status).toBe("ready_to_add");
  });
  it("任务版本、实验版本及用户隔离；取消不撤销手机购物车", () => {
    const {task,exp} = setup();
    expect(() => cart.getCartExperiment("other",exp.id)).toThrow("本用户");
    expect(() => change(exp,"baseline",{expectedVersion:0,cart:[]})).toThrow("实验已变化");
    shopping.editShoppingItem(user,task.id,task.items[0].id,{expectedVersion:task.version,amount:"2 份"});
    expect(() => change(exp,"baseline",{cart:[]})).toThrow("采购任务已变化");
    const cancelled = change(exp,"cancel"); expect(cancelled.status).toBe("cancelled");
    expect(cancelled.issues[0]).toContain("不删除或撤销");
  });
  it("相同操作重试不产生第二个步骤，导出和删除包括实验记录", () => {
    const {task,exp:created} = setup(); const exp = selected(created,task), step = exp.steps[0];
    const payload = {operationId:"cart-step-operation-001",expectedVersion:exp.version,stepId:step.id,contextConfirmed:true,completeCartConfirmed:true,cart:[]};
    const action = () => cart.changeCartExperiment(user,exp.id,"begin-step",payload);
    const once = executeWebWriteOnce(getDatabase(),user,"cart-step",payload,action);
    expect(executeWebWriteOnce(getDatabase(),user,"cart-step",payload,action)).toEqual(once);
    expect(cart.getCartExperiment(user,exp.id).events.filter(e => e.type === "manual_step_registered_before_phone_action")).toHaveLength(1);
    const path = privacy.exportUserData(user,[]);
    expect(JSON.parse(readFileSync(path,"utf8")).database.shopping.shopping_cart_experiments).toHaveLength(1);
    privacy.deleteUserData(user,()=>{}); expect(cart.listCartExperiments(user)).toEqual([]);
  });
  it("预算、重复商品、过期实验和非法购物车都在操作前拒绝", () => {
    const {task,exp:created} = setup();
    expect(() => cart.createCartExperiment(user,{taskId:task.id,expectedTaskVersion:task.version,itemIds:[task.items[0].id],phoneOS:"ios",store:"超市 A",accountLabel:"B"})).toThrow("已有未结束");
    const exp = change(created,"baseline",{cart:[]});
    expect(() => cart.cartSnapshot([{store:"A",title:"B",specification:"C",quantity:0}])).toThrow("件数");
    const row = {store:"A",title:"B",specification:"C",quantity:1};
    expect(() => cart.cartSnapshot([row,row])).toThrow("重复计数");
    vi.spyOn(Date,"now").mockReturnValue(Date.parse(exp.updatedAt) + 31 * 60_000);
    expect(() => change(exp,"prepare")).toThrow("30 分钟");
  });
  it("预计新增金额超过预算时不生成步骤，两个需求不能重复选择同一 SKU", () => {
    const {task,exp:created} = setup(); change(created,"cancel");
    let exp = cart.createCartExperiment(user,{taskId:task.id,expectedTaskVersion:task.version,itemIds:task.items.map(i => i.id),phoneOS:"ios",store:"超市 A",accountLabel:"账号 B",budgetCents:1000});
    exp = change(exp,"baseline",{cart:[]});
    const candidate = {store:"超市 A",title:"同商品",specification:"500 克/份",quantity:1,priceCents:500,specificationConfirmed:true,availableConfirmed:true};
    exp = change(exp,"select",{...candidate,itemId:task.items[0].id});
    expect(() => change(exp,"select",{...candidate,itemId:task.items[1].id})).toThrow("同一商品");
    for (const item of task.items) exp = change(exp,"select",{...candidate,itemId:item.id,title:item.name});
    expect(() => change(exp,"prepare")).toThrow("超过预算");
    expect(cart.getCartExperiment(user,exp.id).steps).toEqual([]);
  });
  it("手机页面清楚标记手动记录，文本解析不猜测规格或件数", () => {
    const source = readFileSync(new URL("../../public/cartExperimentView.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replaceAll("export function","function");
    const module = runInNewContext(source+"\n({parseCartText,renderCartExperiments});",{esc:(v:unknown) => String(v ?? "").replaceAll("<","&lt;"),list:(v:unknown) => Array.isArray(v) ? v : [],panel:(_title:string,html:string) => html});
    expect(module.parseCartText("店 | 番茄 | 500 克/份 | 2 | 5.50")[0]).toMatchObject({quantity:2,priceCents:550});
    expect(() => module.parseCartText("番茄 | 500 克")).toThrow("格式");
    expect(module.renderCartExperiments({shopping:{}},null)).toContain("尚未连接手机自动控制");
    const {task,exp} = setup();
    const html = module.renderCartExperiments({shopping:{cartExperiments:[exp]}},task);
    expect(html).toContain("数据来源：用户手动确认"); expect(html).toContain("空白代表已确认空车");
  });
});
