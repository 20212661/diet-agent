import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { wrapToolsForUser } from "../agent/modelAdapter.js";

afterEach(() => vi.restoreAllMocks());

describe("工具错误诊断脱敏", () => {
  it("保留重试行为和允许的错误码，但不输出错误正文或自定义错误名", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = Object.assign(new Error("database is locked: 用户健康信息"), { code: "SQLITE_BUSY", name: "敏感错误名" });
    const execute = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ content: [] });
    const tool = wrapToolsForUser("user", [{ name: "test_tool", label: "测试", description: "测试",
      parameters: Type.Object({}), execute }])[0];
    await tool.execute("call", {}, undefined, undefined, {} as never);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("code=SQLITE_BUSY"));
    expect(warning.mock.calls.flat().join(" ")).not.toMatch(/用户健康信息|敏感错误名|database is locked/);
  });

  it("未知错误码不会泄露内容，原错误仍返回调用方", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = Object.assign(new Error("私密资料"), { code: "private-token" });
    const tool = wrapToolsForUser("user", [{ name: "test_tool", label: "测试", description: "测试",
      parameters: Type.Object({}), execute: vi.fn().mockRejectedValue(error) }])[0];
    await expect(tool.execute("call", {}, undefined, undefined, {} as never)).rejects.toBe(error);
    expect(warning.mock.calls.flat().join(" ")).not.toMatch(/私密资料|private-token/);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("code=unknown"));
  });
});
