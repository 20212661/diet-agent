import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

class Element {
  children: Element[] = [];
  textContent = ""; value = ""; className = ""; disabled = false; hidden = false;
  scrollTop = 0; scrollHeight = 0;
  classList = { add: vi.fn() };
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener = vi.fn();
  focus = vi.fn();
}

function setup() {
  const nodes = new Map<string, Element>();
  const selector = (key: string) => {
    if (key === ".welcome-message") return null;
    if (!nodes.has(key)) nodes.set(key, new Element());
    return nodes.get(key)!;
  };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response('data: {"type":"tool","toolName":"log_meal","phase":"pending"}\n\n'
    + 'data: {"type":"done","reply":"已完成"}\n\n'));
  const sources = ["recoveryStore", "chatController"].map((name) => readFileSync(new URL(`../../public/${name}.js`, import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export function", "function")).join("\n");
  const createChatController = runInNewContext(sources + "\ncreateChatController;", {
    document: { createElement: () => new Element() }, localStorage: storage, fetch, TextDecoder,
    setTimeout: vi.fn(), console,
  });
  const state = { userId: "a" };
  const controller = createChatController({ $: selector, esc: (value: string) => value, getData: () => state,
    getCurrentPage: () => "overview", toast: vi.fn(), renderPage: vi.fn(), refreshData: vi.fn(),
    modelStatusLabel: () => "已就绪", clientOperationId: () => "browser-chat-operation", useSlash: vi.fn(), slashCommands: [] });
  return { controller, fetch, nodes, values, state };
}

describe("浏览器聊天恢复生命周期", () => {
  it("身份绑定前不发送，绑定其他用户后不恢复旧消息", async () => {
    const { controller, fetch, nodes, values, state } = setup();
    values.set("diet-agent:user:a:pending-chat-request", JSON.stringify({ userId: "a", message: "用户 A 的信息", operationId: "a-operation", status: "sending" }));
    await controller.sendChat("尚未加载用户");
    expect(fetch).not.toHaveBeenCalled();
    controller.bindRecoveryUser("a");
    expect(nodes.get("#chat-input")!.disabled).toBe(true);
    expect(controller.statusLabel()).toBe("结果待核对");
    expect(fetch).not.toHaveBeenCalled();
    state.userId = "b";
    controller.bindRecoveryUser("b");
    expect(nodes.get("#chat-messages")!.children).toHaveLength(0);
    expect(nodes.get("#chat-input")!.disabled).toBe(false);
    await controller.sendChat("用户 B 的消息");
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).message).toBe("用户 B 的消息");
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ "X-Diet-User-Id": "b" });
    expect(values.has("diet-agent:user:b:pending-chat-request")).toBe(false);
    expect(values.has("diet-agent:user:a:pending-chat-request")).toBe(true);
    expect(controller.statusLabel()).toBe("已就绪");
  });

  it("工作台入口可加载拆分模块并渲染七个页面", async () => {
    const nodes = new Map<string, any>();
    const node = (key: string) => {
      if (!nodes.has(key)) nodes.set(key, { ...new Element(), style: {}, dataset: {}, innerHTML: "",
        classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, addEventListener: vi.fn(),
        append: vi.fn(), querySelector: () => ({ dataset: {} }), querySelectorAll: () => [], insertAdjacentHTML: vi.fn() });
      return nodes.get(key);
    };
    const dashboard = { userId: "startup-user", date: "2030-04-08", profile: null,
      kitchen: { burners: 2, hasOven: true, hasMicrowave: false, hasRiceCooker: false, cookware: [],
        tastePreferences: [], cookingPreferences: [], maxActiveMinutes: 20, maxTotalMinutes: 35 },
      inventory: { availableIngredients: [], shoppingList: [] }, today: { meals: [] }, weeklyPlan: null,
      agent: { model: "test", status: "unconfigured", tools: [], dataFile: "test.sqlite" } };
    const code = [
      "recoveryStore",
      "viewFormatters",
      "inventoryView",
      "diaryView",
      "profileKitchenViews",
      "planAgentViews",
      "chatController",
      "planDialog",
      "app",
    ].map((name) =>
      readFileSync(new URL(`../../public/${name}.js`, import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/export function/g, "function")).join("\n");
    const app = runInNewContext(code + "\n({navigate, refreshData});", {
      document: { querySelector: node, querySelectorAll: () => [], createElement: () => node("dialog"),
        body: { append: vi.fn() }, addEventListener: vi.fn(), title: "" },
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      fetch: vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("dashboard") ? dashboard
        : url.includes("dates") ? [] : { meals: [], deletedMeals: [] }))),
      console, setTimeout: vi.fn(), clearTimeout: vi.fn(), TextDecoder,
    });
    await app.refreshData();
    for (const page of ["overview", "profile", "kitchen", "inventory", "diary", "plan", "agent"]) {
      expect(() => app.navigate(page)).not.toThrow();
      expect(node("#page-content").innerHTML).not.toContain("暂时无法读取工作区");
      expect(node("#page-title").textContent).toBeTruthy();
    }
  });
  it("切换身份后旧请求的迟到响应不会清除新用户状态", async () => {
    const { controller, fetch, nodes, values, state } = setup();
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    controller.bindRecoveryUser("a");
    const pending = controller.sendChat("用户 A 尚未完成的消息");
    state.userId = "b";
    controller.bindRecoveryUser("b");
    nodes.get("#chat-input")!.value = "用户 B 正在输入";
    finish(new Response('data: {"type":"done","reply":"用户 A 的迟到回复"}\n\n'));
    await pending;
    expect(nodes.get("#chat-input")!.value).toBe("用户 B 正在输入");
    expect(nodes.get("#chat-messages")!.children).toHaveLength(0);
    expect(values.has("diet-agent:user:a:pending-chat-request")).toBe(true);
    expect(controller.statusLabel()).toBe("已就绪");
  });

  it("旧页面请求被服务端拒绝后保留原用户恢复消息，不自动重发", async () => {
    const { controller, fetch, values, state } = setup();
    state.userId = "用户 A";
    controller.bindRecoveryUser(state.userId);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: "user_changed", error: "当前用户已变化" }), { status: 409 }));
    await controller.sendChat("原用户待恢复消息");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ "X-Diet-User-Id": encodeURIComponent("用户 A") });
    const saved = JSON.parse(values.get(`diet-agent:user:${encodeURIComponent("用户 A")}:pending-chat-request`)!);
    expect(saved).toMatchObject({ userId: "用户 A", message: "原用户待恢复消息", status: "failed_before_write" });
  });

});
