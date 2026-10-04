import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function setup() {
  const handlers = new Map<string, (event?: unknown) => Promise<void> | void>();
  const dialog = { open: false, innerHTML: "", className: "",
    showModal() { this.open = true; }, close() { this.open = false; handlers.get("close")?.(); },
    addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
    querySelectorAll: () => [] };
  const recipe = (id: string) => ({ id, name: `菜${id}`, ingredients: ["番茄"], steps: ["制作"],
    appliances: [], cookware: [], activeMinutes: 5, totalMinutes: 10 });
  const data = { userId: "user-a", weeklyPlan: { weekStartDate: "2030-04-08", updatedAt: "version-1",
    days: ["2030-04-08", "2030-04-09"].map((date, i) => ({ date, mainRecipe: recipe(String(i)), completed: false })) } };
  const finishOld: Array<() => void> = [];
  const fetch = vi.fn((url: string, options?: RequestInit): Promise<unknown> => {
    if (options?.method) return Promise.resolve({ ok: true, json: async () => ({ saved: true }) });
    const payload = url.includes("/api/recipes/") ? { recipe: recipe(url.endsWith("0") ? "0" : "1") } : { alternatives: [] };
    const response = { ok: true, json: async () => payload };
    if (url.endsWith("/0") || url.includes("/day/2030-04-08/")) {
      return new Promise((resolve) => finishOld.push(() => resolve(response)));
    }
    return Promise.resolve(response);
  });
  const source = readFileSync(new URL("../../public/planDialog.js", import.meta.url), "utf8").replace("export function", "function");
  const create = runInNewContext(source + "\ncreatePlanDialog;", {
    document: { createElement: () => dialog, body: { append() {} } }, fetch,
    localStorage: { removeItem() {} },
  });
  const controller = create({ getData: () => data, esc: String, list: (value: unknown) => Array.isArray(value) ? value : [],
    toast: vi.fn(), renderPage: vi.fn(), refreshData: vi.fn(),
    getPendingWrite: (_url: string, payload: unknown) => ({ userId: data.userId, payload, operationId: "test-operation", key: "test" }) });
  const clickComplete = () => handlers.get("click")!({ target: { closest: (selector: string) =>
    selector === "[data-plan-completed]" ? { dataset: { planCompleted: "true" } } : null } });
  return { controller, data, dialog, fetch, finishOld, clickComplete };
}

describe("周计划弹窗异步一致性", () => {
  it("关闭 A 后打开 B，迟到的 A 不覆盖 B，写入绑定 B 的显示快照", async () => {
    const { controller, dialog, fetch, finishOld, clickComplete } = setup();
    const old = controller.openPlanDay("2030-04-08");
    dialog.close();
    await controller.openPlanDay("2030-04-09");
    finishOld.forEach((finish) => finish());
    await old;
    expect(dialog.innerHTML).toContain("菜1");
    expect(dialog.innerHTML).not.toContain("菜0");
    await clickComplete();
    const writes = fetch.mock.calls.filter(([, options]) => options?.method);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({ date: "2030-04-09", recipeId: "1", updatedAt: "version-1" });
  });

  it("显示后计划版本变化，禁止将旧菜谱操作应用到新计划", async () => {
    const { controller, data, fetch, clickComplete } = setup();
    await controller.openPlanDay("2030-04-09");
    data.weeklyPlan.updatedAt = "version-2";
    await clickComplete();
    expect(fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("关闭或切换用户后，迟到响应不会恢复旧弹窗", async () => {
    const { controller, data, dialog, finishOld } = setup();
    const old = controller.openPlanDay("2030-04-08");
    dialog.close();
    data.userId = "user-b";
    finishOld.forEach((finish) => finish());
    await old;
    expect(dialog.open).toBe(false);
    expect(dialog.innerHTML).not.toContain("菜0");
  });
});
