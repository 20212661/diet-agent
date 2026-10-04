import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Execute the exact browser module without adding a DOM or bundler dependency.
const source = readFileSync(new URL("../../public/recoveryStore.js", import.meta.url), "utf8");
const createRecoveryStore = runInNewContext(source.replace("export function", "function") + "\ncreateRecoveryStore;") as
  (storage: Storage, userId: string, createId: () => string) => {
    chatKey: string; loadChat(): any; saveChat(request: any): void; getPendingWrite(endpoint: string, payload: any): any;
  };
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage;
beforeEach(() => values.clear());

describe("浏览器请求恢复按用户隔离", () => {
  it("切换用户不会显示或重发其他用户的待处理消息", () => {
    const a = createRecoveryStore(storage, "a", () => "operation-a");
    a.saveChat({ message: "用户 A 的健康信息", operationId: "chat-a", status: "sending" });
    const b = createRecoveryStore(storage, "b", () => "operation-b");
    expect(b.loadChat()).toBeNull();
    expect(a.loadChat()).toMatchObject({ userId: "a", status: "result_uncertain" });
    expect(() => b.saveChat(a.loadChat())).toThrow("用户已变化");
  });

  it("同一写入可安全重试，不同用户相同内容获得独立请求 ID", () => {
    const a = createRecoveryStore(storage, "a", () => "operation-a");
    const b = createRecoveryStore(storage, "b", () => "operation-b");
    const payload = { foods: [{ name: "米饭" }] };
    expect(a.getPendingWrite("/api/meals", payload).operationId).toBe("operation-a");
    expect(a.getPendingWrite("/api/meals", payload).operationId).toBe("operation-a");
    expect(b.getPendingWrite("/api/meals", payload).operationId).toBe("operation-b");
  });

  it("拒绝错配身份和旧版无身份缓存，损坏缓存不阻塞启动", () => {
    const a = createRecoveryStore(storage, "a/b", () => "fresh-operation");
    values.set("diet-agent:pending-chat-request", JSON.stringify({ message: "legacy", operationId: "legacy-op" }));
    expect(a.loadChat()).toBeNull();
    values.set(a.chatKey, JSON.stringify({ userId: "a?b", message: "wrong", operationId: "wrong-op" }));
    expect(a.loadChat()).toBeNull();
    values.set(a.chatKey, "invalid json");
    expect(a.loadChat()).toBeNull();
    expect(() => createRecoveryStore(storage, "", () => "id")).toThrow();
  });
});
