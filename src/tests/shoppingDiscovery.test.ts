import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
process.env.DIET_AGENT_DB_PATH = ":memory:";
const store = await import("../store/index.js");
const {getDatabase} = await import("../store/database.js");
const {signTaobao, taobaoTimestamp, callTaobao} = await import("../shopping/taobaoClient.js");
const {searchShoppingStores, getShoppingPurchaseLink, officialApiStatus, validateOfficialLink} = await import("../shopping/discovery.js");
const privacy = await import("../privacy/userData.js");
const input = {keyword: "超市", longitude: "116.404", latitude: "39.928", locationConsent: true};
const record = {title:"食材超市", shop_id:"encrypted-store-id", delivery_price:"15.00", delivery_fee:"3.50", items:{promotion_item:[{title:"番茄",price:"4.99"}]}};
function response(action: string, data: unknown, extras = {}) {
  return new Response(JSON.stringify({[`alibaba_alsc_union_eleme_promotion_storepromotion_${action}_response`]:{result_code:0,data,...extras}}));
}
beforeEach(() => {
  store.closeDatabase();
  vi.stubEnv("TAOBAO_UNION_APP_KEY", "test-app"); vi.stubEnv("TAOBAO_UNION_APP_SECRET", "never-expose-secret"); vi.stubEnv("TAOBAO_UNION_PID", "test-pid");
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); store.closeDatabase();});
describe("官方购物查询与取链", () => {
  it("按 TOP HMAC-MD5 排序签名，忽略 sign 和空值，时间固定为 GMT+8", () => {
    // RFC 2202 HMAC-MD5 test vector 2, represented as TOP key+value concatenation.
    expect(signTaobao({"what do ya want for ":"nothing?",sign:"ignore",empty:""},"Jefe")).toBe("750C783E6AB0B503EAA86E310A5DB738");
    expect(signTaobao({b:"2",a:"1"},"secret")).toBe(signTaobao({a:"1",b:"2"},"secret"));
    expect(taobaoTimestamp(new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-02 04:00:00");
  });
  it("凭证未配置或美团未核验时不请求平台", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubEnv("TAOBAO_UNION_PID", "");
    expect(officialApiStatus("u","taobao").status).toBe("unconfigured");
    await expect(searchShoppingStores("u","taobao",input)).rejects.toMatchObject({status:503});
    await expect(searchShoppingStores("u","meituan",input)).rejects.toMatchObject({status:503});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("未确认定位、空值及错误坐标在联网前拒绝", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const extra of [{locationConsent:false},{longitude:""},{longitude:"181"},{latitude:"91"},{latitude:"1.1234567"},{keyword:""}]) {
      await expect(searchShoppingStores("u","taobao",{...input,...extra})).rejects.toMatchObject({status:422});
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("按距离查询、返回来源和整数分，不向客户端泄露凭证或门店 ID", async () => {
    const fetch = vi.fn(async () => response("query",{records:{store_promotion_dto:[record]}})); vi.stubGlobal("fetch", fetch);
    expect(officialApiStatus("u","taobao").storeSearch).toBe(false);
    const result = await searchShoppingStores("u","taobao",input);
    const [url, options] = fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://eco.taobao.com/router/rest"); expect(options.redirect).toBe("error");
    const params = new URLSearchParams(options.body as URLSearchParams);
    expect(JSON.parse(params.get("query_request")!)).toMatchObject({pid:"test-pid",sort_type:"distance",longitude:"116.404",search_content:"超市"});
    expect(result.candidates[0]).toMatchObject({title:"食材超市",minimumOrderCents:1500,deliveryFeeCents:350,items:[{title:"番茄",priceCents:499,specification:"待核对"}]});
    expect(JSON.stringify(result)).not.toContain("encrypted-store-id"); expect(JSON.stringify(result)).not.toContain("never-expose-secret");
    expect(officialApiStatus("u","taobao")).toMatchObject({status:"verified",storeSearch:true,purchaseLink:false});
    expect(officialApiStatus("other","taobao").storeSearch).toBe(false);
    expect(JSON.stringify(getDatabase().prepare("SELECT * FROM shopping_candidates").all())).not.toContain("116.404");
  });
  it("取链用户隔离、缓存、过期及更换凭证后重新核验", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("query",{records:[record]})).mockResolvedValue(response("get",{link:{h5_url:"https://shop.ele.me/buy"}})); vi.stubGlobal("fetch",fetch);
    const candidate = (await searchShoppingStores("u","taobao",input)).candidates[0];
    await expect(getShoppingPurchaseLink("other","taobao",candidate.id)).rejects.toMatchObject({status:404});
    const link = await getShoppingPurchaseLink("u","taobao",candidate.id);
    expect(link).toMatchObject({url:"https://shop.ele.me/buy",statusSource:"official_api"});
    expect(await getShoppingPurchaseLink("u","taobao",candidate.id)).toEqual(link); expect(fetch).toHaveBeenCalledTimes(2);
    expect(officialApiStatus("u","taobao").purchaseLink).toBe(true);
    getDatabase().prepare("UPDATE shopping_candidates SET expires_at='2000-01-01T00:00:00Z'").run();
    await expect(getShoppingPurchaseLink("u","taobao",candidate.id)).rejects.toMatchObject({status:409});
    vi.stubEnv("TAOBAO_UNION_APP_SECRET","different-secret");
    expect(officialApiStatus("u","taobao").status).toBe("pending_verification");
    await expect(getShoppingPurchaseLink("u","taobao",candidate.id)).rejects.toMatchObject({status:404});
  });
  it("平台错误不透出上游内容，响应异常不把权限记为成功", async () => {
    vi.stubGlobal("fetch",vi.fn(async () => new Response(JSON.stringify({error_response:{msg:"never-expose-secret"}}))));
    await expect(searchShoppingStores("u","taobao",input)).rejects.toThrow("核对联盟应用权限");
    expect(officialApiStatus("u","taobao").status).toBe("failed");
    vi.stubGlobal("fetch",vi.fn(async () => response("query",{records:"bad"})));
    await expect(searchShoppingStores("u","taobao",input)).rejects.toThrow("格式异常");
    vi.stubGlobal("fetch",vi.fn(async () => {throw new Error("never-expose-secret");}));
    await expect(callTaobao("query",{})).rejects.toThrow("网络失败");
  });
  it("链接只允许官方 HTTPS，支持官方文档中的淘宝跳转域名", () => {
    expect(validateOfficialLink("https://m.duanqu.com/?page=store")).toContain("m.duanqu.com");
    for (const url of ["http://ele.me/", "https://ele.me.evil.test/", "https://evil.test/", "https://127.0.0.1/", "https://user:secret@ele.me/", "https://ele.me:444/", "javascript:alert(1)"]) expect(() => validateOfficialLink(url)).toThrow();
  });
  it("空列表成功仍保留手动入口；候选与核验记录纳入删除范围", async () => {
    vi.stubGlobal("fetch",vi.fn(async () => response("query",{records:[]})));
    expect((await searchShoppingStores("u","taobao",input)).candidates).toEqual([]);
    expect(officialApiStatus("u","taobao").storeSearch).toBe(true);
    store.clearUserData("u");
    expect(getDatabase().prepare("SELECT * FROM shopping_provider_checks WHERE user_id='u'").all()).toEqual([]);
    expect(privacy.getUserDataOverview("u").database.shoppingCandidates).toBe(0);
  });
  it("页面显示真实能力、未配置查询按钮禁用并对结果文字转义", () => {
    const source = readFileSync(new URL("../../public/shoppingView.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace("export function","function");
    const factory = runInNewContext(source+"\ncreateShoppingController",{renderCartExperiments:()=>"",esc:(v: unknown) => String(v ?? "").replaceAll("<","&lt;"),list:(v: unknown) => Array.isArray(v) ? v : [],panel:(_title: string,html: string) => html});
    const controller = factory({root:{addEventListener:vi.fn()},getData:()=>({}),toast:vi.fn()});
    const html = controller.render({userId:"u",inventory:{shoppingList:[]},shopping:{tasks:[],providers:[{id:"taobao",label:"淘宝闪购",entryUrl:"",officialApi:{configured:false,status:"unconfigured",scope:"<unsafe>"}}]}});
    expect(html).toContain("待配置联盟凭证"); expect(html).toContain("&lt;unsafe>"); expect(html).toMatch(/disabled>查询附近门店/);
  });
});
