import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveEmbeddingConfig } from "../rag/embeddingAdapter.js";

describe("resolveEmbeddingConfig 默认 local embedding（含三种退回）", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("默认（无 EMBEDDING_PROVIDER）返回 local 配置", () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.CI;
    const config = resolveEmbeddingConfig();
    expect(config).toMatchObject({ provider: "local", dim: 512 });
  });

  it("EMBEDDING_PROVIDER=off 显式关闭", () => {
    process.env.EMBEDDING_PROVIDER = "off";
    expect(resolveEmbeddingConfig()).toBeUndefined();
  });

  it("CI=true 不下载模型，退回 undefined（纯 FTS）", () => {
    delete process.env.EMBEDDING_PROVIDER;
    process.env.CI = "true";
    expect(resolveEmbeddingConfig()).toBeUndefined();
  });

  it("显式 local 优先于 CI 检测（CI 中测试 local 行为时使用）", () => {
    process.env.EMBEDDING_PROVIDER = "local";
    process.env.CI = "true";
    expect(resolveEmbeddingConfig()).toMatchObject({ provider: "local" });
  });

  it("显式 openai 需要 API key", () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    // 无 key 时退回默认 local
    delete process.env.CI;
    expect(resolveEmbeddingConfig()?.provider).toBe("local");
    process.env.OPENAI_API_KEY = "test-key";
    expect(resolveEmbeddingConfig()?.provider).toBe("openai");
  });
});

describe("getRetriever embedding 退回", () => {
  it("EMBEDDING_PROVIDER=off → 纯 FTS 正常启动（显式关闭路径）", { timeout: 15_000 }, async () => {
    process.env.DIET_AGENT_DB_PATH = ":memory:";
    process.env.EMBEDDING_PROVIDER = "off";
    const { getRetriever, _resetRetrieverForTests } = await import("../rag/recipeRetriever.js");
    _resetRetrieverForTests();
    const retriever = await getRetriever();
    expect(retriever).not.toBeNull();
    expect(retriever!.backends.vector).toBeNull();
    expect(retriever!.backends.fts).toBe(true);
    const result = await retriever!.recall("番茄炒蛋", 5);
    expect(result.recipes.length).toBeGreaterThan(0);
  });

  it("local 模型加载失败（离线/未安装/下载失败）→ 退回纯 FTS 不阻塞启动", { timeout: 15_000 }, async () => {
    process.env.DIET_AGENT_DB_PATH = ":memory:";
    // 模拟离线（localEmbedder 检查离线标记，模型缓存不完整时直接 throw）
    process.env.EMBEDDING_PROVIDER = "local";
    process.env.HF_HUB_OFFLINE = "1";
    // 清掉已有的 retriever 单例
    const { getRetriever, _resetRetrieverForTests } = await import("../rag/recipeRetriever.js");
    _resetRetrieverForTests();
    const retriever = await getRetriever();
    delete process.env.HF_HUB_OFFLINE;
    // 无论 local 是否成功，retriever 都不应为 null（至少 FTS 可用）
    // 如果本机有缓存则 local 成功（vector=sqlite-vec）；离线/无缓存则退回纯 FTS（vector=null）
    expect(retriever).not.toBeNull();
    expect(retriever!.backends.fts).toBe(true);
    // recall 仍能工作
    const result = await retriever!.recall("番茄炒蛋", 5);
    expect(result.recipes.length).toBeGreaterThan(0);
  });
});
