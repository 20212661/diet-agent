import { describe, expect, it, vi } from "vitest";
import { checkModelConfiguration, formatModelCheckResult } from "../agent/configDoctor.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("模型配置诊断", () => {
  it("区分缺少 Key，且输出不包含任何密钥", async () => {
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "deepseek",
      MODEL_ID: "deepseek-flash",
    }, vi.fn());

    expect(result.code).toBe("missing_key");
    expect(result.severity).toBe("error");
    expect(formatModelCheckResult(result)).not.toContain("sk-");
  });

  it("区分无效 Key，且不把 Key 写进诊断结果", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "invalid key" }));
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "deepseek",
      MODEL_ID: "deepseek-flash",
      DEEPSEEK_API_KEY: "super-secret-key",
    }, fetchMock);

    expect(result.code).toBe("invalid_key");
    expect(JSON.stringify(result)).not.toContain("super-secret-key");
  });

  it("识别不存在的模型", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }],
    }));
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "deepseek",
      MODEL_ID: "missing-model",
      DEEPSEEK_API_KEY: "secret",
    }, fetchMock);

    expect(result.code).toBe("invalid_model");
    expect(result.model).toBe("missing-model");
  });

  it("接受旧 Flash 别名并返回规范模型名", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }],
    }));
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "deepseek",
      MODEL_ID: "deepseek-v4-flash",
      DEEPSEEK_API_KEY: "secret",
    }, fetchMock);

    expect(result.code).toBe("ok");
    expect(result.model).toBe("deepseek-flash");
  });

  it("网络异常只警告，不阻止离线启动", async () => {
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "deepseek",
      MODEL_ID: "deepseek-flash",
      DEEPSEEK_API_KEY: "secret",
    }, vi.fn(async () => { throw new Error("offline"); }));

    expect(result.code).toBe("network_error");
    expect(result.severity).toBe("warning");
  });

  it("只有配置 Key 不算连接验证通过", async () => {
    const fetchMock = vi.fn();
    const result = await checkModelConfiguration({
      MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "configured-key",
    }, fetchMock);

    expect(result.code).toBe("remote_check_unavailable");
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.nextStep).toContain("npm run doctor");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
