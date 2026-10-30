import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const { createWebServer } = await import("../web/server.js");
let server: Server, base: string, seq = 0;
const userId = "采购 HTTP 用户";
beforeEach(async () => {
  store.closeDatabase();
  server = createWebServer({userId,host:"127.0.0.1",port:0});
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.restoreAllMocks(); vi.unstubAllEnvs(); store.closeDatabase(); });
async function request(path: string, payload?: Record<string,unknown>, options: RequestInit = {}) {
  const response = await fetch(base + path, {method: payload ? "POST" : "GET", headers:{"Content-Type":"application/json", "X-Diet-User-Id":encodeURIComponent(userId)}, ...(payload ? {body:JSON.stringify({operationId:`shopping-http-${++seq}`, ...payload})} : {}), ...options});
  return {status:response.status,body:await response.json()};
}
async function setup() {
  const inv = store.upsertIngredientInventory(userId,{shoppingList:[{name:"番茄",amount:"500 克",status:"planned"}]});
  return {inv, result:await request("/api/shopping/tasks", {provider:"meituan",inventoryUpdatedAt:inv.updatedAt,items:[{sourceItemId:inv.shoppingList[0].id}]})};
}
describe("采购 HTTP 边界", () => {
  it("手机实验从创建到审阅走 HTTP，记录幂等且不修改采购状态", async () => {
    const inv = store.upsertIngredientInventory(userId,{shoppingList:[{name:"番茄",amount:"500 克",status:"planned"}]});
    const task = (await request("/api/shopping/tasks",{provider:"taobao",inventoryUpdatedAt:inv.updatedAt,items:[{sourceItemId:inv.shoppingList[0].id}]})).body.task;
    const create = await request("/api/shopping/cart-experiments",{taskId:task.id,expectedTaskVersion:task.version,itemIds:[task.items[0].id],phoneOS:"android",store:"演示店",accountLabel:"A"});
    expect(create.status).toBe(201); let exp = create.body.experiment;
    const act = async (action: string, extra = {}) => request(`/api/shopping/cart-experiments/${exp.id}/${action}`,{expectedVersion:exp.version,contextConfirmed:true,completeCartConfirmed:true,...extra});
    exp = (await act("baseline",{cart:[]})).body.experiment;
    const product = {store:"演示店",title:"番茄",specification:"500 克/份",quantity:1,priceCents:499};
    exp = (await act("select",{...product,itemId:task.items[0].id,specificationConfirmed:true,availableConfirmed:true})).body.experiment;
    exp = (await act("prepare")).body.experiment;
    const step = exp.steps[0], beginVersion = exp.version;
    const once = await act("begin-step",{operationId:"http-cart-step-001",stepId:step.id,cart:[]});
    expect((await act("begin-step",{operationId:"http-cart-step-001",stepId:step.id,cart:[],expectedVersion:beginVersion})).body).toEqual(once.body);
    exp = once.body.experiment;
    expect((await act("begin-step",{stepId:step.id,cart:[]})).status).toBe(422);
    exp = (await act("reconcile",{stepId:step.id,cart:[product]})).body.experiment;
    expect(exp.status).toBe("review_ready"); expect(exp.evidenceSource).toBe("user_confirmed");
    expect((await request(`/api/shopping/cart-experiments/${exp.id}`)).body.experiment).toEqual(exp);
    expect((await request("/api/dashboard")).body.shopping.cartExperiments).toHaveLength(1);
    expect((await request(`/api/shopping/tasks/${task.id}`)).body.task.status).toBe("draft");
    expect((await fetch(base+"/cartExperimentView.js")).status).toBe(200);
  });
  it("官方查询和二维码走 HTTP；跨站调用在联网前拒绝，查询不改变任务和库存", async () => {
    vi.stubEnv("TAOBAO_UNION_APP_KEY","test-key"); vi.stubEnv("TAOBAO_UNION_APP_SECRET","private-test-secret"); vi.stubEnv("TAOBAO_UNION_PID","test-pid");
    const realFetch = globalThis.fetch;
    const upstream = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const params = new URLSearchParams(options?.body as URLSearchParams);
      const action = params.get("method")!.split(".").at(-1);
      const data = action === "query" ? {records:[{shop_id:"private-shop-id",title:"附近超市"}]} : {link:{h5_url:"https://shop.ele.me/buy"}};
      return new Response(JSON.stringify({[`alibaba_alsc_union_eleme_promotion_storepromotion_${action}_response`]:{result_code:0,data}}));
    });
    vi.spyOn(globalThis,"fetch").mockImplementation((url, options) => String(url) === "https://eco.taobao.com/router/rest" ? upstream(url,options) : realFetch(url,options));
    const input = {keyword:"超市",longitude:"116.404",latitude:"39.928",locationConsent:true};
    const blocked = await request("/api/shopping/providers/taobao/search",input,{headers:{"Content-Type":"application/json","X-Diet-User-Id":encodeURIComponent(userId),Origin:"https://evil.test"}});
    expect(blocked.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
    const found = await request("/api/shopping/providers/taobao/search",input);
    expect(found.status).toBe(200); expect(JSON.stringify(found.body)).not.toContain("private-test-secret");
    const link = await request("/api/shopping/providers/taobao/purchase-link",{candidateId:found.body.candidates[0].id});
    expect(link.status).toBe(200); expect(link.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(link.body.statusSource).toBe("official_api");
    expect((await request("/api/shopping/providers/taobao/purchase-link",{candidateId:"missing"})).status).toBe(404);
    expect((await request("/api/shopping/providers/meituan/search",input)).status).toBe(503);
    expect((await request("/api/shopping/tasks")).body.tasks).toEqual([]);
    expect(store.getIngredientInventory(userId).availableIngredients).toEqual([]);
    const provider = (await request("/api/shopping/providers")).body.providers.find((p: {id:string}) => p.id === "taobao");
    expect(provider.capabilities).toMatchObject({storeSearch:true,purchaseLink:true,productSearch:false,cartWrite:false,orderCreate:false});
  });
  it("创建、编辑、交接二维码、记录下单、收货与重试走完整 HTTP 流程", async () => {
    const {inv,result} = await setup(); expect(result.status).toBe(201);
    let task = result.body.task;
    expect((await request("/api/dashboard")).body.shopping.tasks).toHaveLength(1);
    expect((await request(`/api/shopping/tasks/${task.id}`)).body.task.id).toBe(task.id);
    expect((await request(`/api/shopping/tasks/${task.id}/handoffs`, {})).status).toBe(422);
    expect((await request("/api/shopping/provider-settings/meituan", {url:"https://www.meituan.com/",verified:true})).status).toBe(200);
    const handoff = await request(`/api/shopping/tasks/${task.id}/handoffs`, {});
    expect(handoff.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(handoff.body.url).not.toContain("127.0.0.1");
    task = (await request(`/api/shopping/tasks/${task.id}/items/${task.items[0].id}`, {amount:"1 kg",expectedVersion:task.version}, {method:"PATCH"})).body.task;
    expect(task.items[0].amount).toBe("1 kg");
    task = (await request(`/api/shopping/tasks/${task.id}/mark-ordered`, {itemIds:[task.items[0].id],expectedVersion:task.version})).body.task;
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(0);
    const payload = {operationId:"http-receipt-fixed-id",expectedVersion:task.version,inventoryUpdatedAt:inv.updatedAt,items:[{itemId:task.items[0].id,name:"番茄",amount:"1 kg",storage:"fridge",complete:true}]};
    const received = await request(`/api/shopping/tasks/${task.id}/receive`, payload);
    expect(received.status).toBe(200); expect(received.body.task.status).toBe("completed");
    expect((await request(`/api/shopping/tasks/${task.id}/receive`, payload)).body).toEqual(received.body);
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(1);
    const conflict = await request(`/api/shopping/tasks/${task.id}/receive`, {...payload,items:[{...payload.items[0],amount:"2 kg"}]});
    expect(conflict.status).toBe(409);
  });
  it("拒绝跨站、缺少身份、非 JSON 和错误身份写入", async () => {
    for (const headers of [
      {"Content-Type":"application/json","X-Diet-User-Id":encodeURIComponent(userId),Origin:"https://evil.test"},
      {"Content-Type":"application/json"},
      {"Content-Type":"text/plain","X-Diet-User-Id":encodeURIComponent(userId)},
      {"Content-Type":"application/json","X-Diet-User-Id":"other"},
    ]) {
      const response = await request("/api/shopping/provider-settings/meituan", {url:"",verified:false}, {headers: new Headers(Object.entries(headers).filter((entry): entry is [string,string] => typeof entry[1] === "string"))});
      expect([403,409,415]).toContain(response.status);
    }
    expect((await request("/api/shopping/providers")).body.providers[0].status).toBe("unconfigured");
  });
  it("图片预览失败不写库存，分页校验与未知任务正确返回", async () => {
    const {result} = await setup();
    expect((await request(`/api/shopping/tasks/${result.body.task.id}/receipt-preview`, {mimeType:"text/plain",data:"invalid"})).status).toBe(400);
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(0);
    expect((await request("/api/shopping/tasks?limit=1000")).status).toBe(422);
    expect((await request("/api/shopping/tasks/missing")).status).toBe(404);
    const module = await fetch(base+"/shoppingView.js"); expect(module.status).toBe(200); expect(await module.text()).toContain("createShoppingController");
  });
  it("跨用户任务不可读写，取消不添加库存", async () => {
    const {result} = await setup(), task = result.body.task;
    const response = await request(`/api/shopping/tasks/${task.id}/cancel-items`, {expectedVersion:1,itemIds:[task.items[0].id]});
    expect(response.body.task.status).toBe("cancelled");
    expect(store.getIngredientInventory(userId).availableIngredients).toHaveLength(0);
    const other = createWebServer({userId:"other",host:"127.0.0.1",port:0});
    await new Promise<void>(resolve => other.listen(0,"127.0.0.1",resolve));
    try {
      const address = other.address() as {port:number};
      expect((await fetch(`http://127.0.0.1:${address.port}/api/shopping/tasks/${task.id}`)).status).toBe(404);
    } finally { await new Promise<void>(resolve => other.close(() => resolve())); }
  });
});
