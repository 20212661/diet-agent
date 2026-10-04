import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EmbeddingConfig } from "../rag/embeddingAdapter.js";

// 测试隔离：retriever 会 import store，先把库指向内存库。
process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { buildRecipeText, hashRecipeText } = await import("../rag/buildRecipeText.js");
const { embed, normalize, resolveEmbeddingConfig } = await import("../rag/embeddingAdapter.js");
const { InMemoryVecStore, SqliteVecStore, createVectorStore } = await import("../rag/vectorStore.js");
const { RecipeRetriever, getRetriever, _resetRetrieverForTests } = await import("../rag/recipeRetriever.js");
const { searchRecipesTool } = await import("../tools/searchRecipes.js");

const EMPTY_EXTENSION_CONTEXT = {} as ExtensionContext;

function freshUser(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeConfig(dim: number): EmbeddingConfig {
  return { provider: "zai", model: "embedding-3", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "test-key", dim };
}

/** 基于文本生成确定性向量，让 mock 的 embedding 可区分不同文本。 */
function deterministicVec(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  for (let i = 0; i < dim; i++) v[i] = ((h >> (i * 3)) & 0xff) / 255;
  return v;
}

/** mock fetch 拦截 embedding 请求，按 input 文本返回确定性向量。 */
function mockFetchEmbed(dim: number) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    const vec = deterministicVec(body.input ?? "", dim);
    return new Response(JSON.stringify({ data: [{ embedding: vec }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("buildRecipeText", () => {
  it("拼接菜名、食材、口味等关键字段", () => {
    const recipe = store.getRecipeBook()[0];
    const text = buildRecipeText(recipe);
    expect(text).toContain(recipe.name);
    expect(text).toContain("食材");
    expect(text).toContain(recipe.ingredients[0]);
  });

  it("相同文本 hash 一致，不同文本 hash 不同", () => {
    expect(hashRecipeText("abc")).toBe(hashRecipeText("abc"));
    expect(hashRecipeText("abc")).not.toBe(hashRecipeText("abd"));
  });
});

describe("embedding 适配", () => {
  beforeEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.ZAI_EMBEDDING_MODEL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("normalize 归一化为单位向量，零向量安全", () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });

  it("resolveEmbeddingConfig：默认只启用 FTS5，不因存在 API Key 自动调用向量服务", () => {
    process.env.ZAI_API_KEY = "z";
    process.env.OPENAI_API_KEY = "o";
    expect(resolveEmbeddingConfig()).toBeUndefined();
  });

  it("resolveEmbeddingConfig：EMBEDDING_PROVIDER=off 关闭向量通道（纯 FTS5）", () => {
    process.env.EMBEDDING_PROVIDER = "off";
    expect(resolveEmbeddingConfig()).toBeUndefined();
  });

  it("resolveEmbeddingConfig：EMBEDDING_PROVIDER=local 显式用本地（即使有 key）", () => {
    process.env.EMBEDDING_PROVIDER = "local";
    process.env.OPENAI_API_KEY = "o";
    expect(resolveEmbeddingConfig()?.provider).toBe("local");
  });

  it("resolveEmbeddingConfig：EMBEDDING_PROVIDER 显式优先", () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "o";
    process.env.ZAI_API_KEY = "z";
    expect(resolveEmbeddingConfig()?.provider).toBe("openai");
  });

  it("embed：发 POST、解析响应、归一化", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [3, 4] }] }), { status: 200 })
    );
    const result = await embed("hi", makeConfig(2));
    expect(result.vector[0]).toBeCloseTo(0.6);
    expect(result.vector[1]).toBeCloseTo(0.8);
    expect(result.dim).toBe(2);

    expect(spy).toHaveBeenCalledOnce();
    const [, init] = spy.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse((init?.body as string) ?? "{}")).toEqual({ model: "embedding-3", input: "hi" });
  });

  it("embed：HTTP 失败抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(embed("hi", makeConfig(2))).rejects.toThrow(/embedding HTTP 401/);
  });
});

describe("向量存储", () => {
  it("InMemoryVecStore：归一化向量的余弦 KNN", () => {
    const s = new InMemoryVecStore(2);
    s.upsert("a", [1, 0]);
    s.upsert("b", [0, 1]);
    const hits = s.knn([1, 0], 2);
    expect(hits[0].id).toBe("a"); // cosine=1 → distance=0
    expect(hits[0].distance).toBeCloseTo(0);
    expect(hits[1].id).toBe("b");
  });

  it("SqliteVecStore：vec0 建表 + KNN（集成）", () => {
    const db = new Database(":memory:");
    const s = new SqliteVecStore(db, 4);
    s.upsert("a", [1, 0, 0, 0]);
    s.upsert("b", [0, 1, 0, 0]);
    const hits = s.knn([1, 0, 0, 0], 1);
    expect(hits[0].id).toBe("a");
    expect(s.size()).toBe(2);
    db.close();
  });

  it("createVectorStore：只清理探测向量，保留已有向量和相同距离的记录", () => {
    const db = new Database(":memory:");
    const existing = new SqliteVecStore(db, 4);
    existing.upsert("saved", [1, 0, 0, 0]);
    const s = createVectorStore(db, 4);
    expect(s.backend).toBe("sqlite-vec");
    expect(s.size()).toBe(1);
    expect(s.has("saved")).toBe(true);
    expect(s.knn([1, 0, 0, 0], 1)[0].id).toBe("saved");
    db.close();
  });
});

describe("RecipeRetriever", () => {
  afterEach(() => vi.restoreAllMocks());

  it("重建检索器复用持久向量，切换同维度模型时重新索引", async () => {
    const spy = mockFetchEmbed(8);
    const db = new Database(":memory:");
    const recipes = store.getRecipeBook().slice(0, 3);
    await new RecipeRetriever(db, makeConfig(8)).indexRecipes(recipes);
    spy.mockClear();
    expect(await new RecipeRetriever(db, makeConfig(8)).indexRecipes(recipes)).toEqual({ embedded: 0, reused: 3 });
    expect(spy).not.toHaveBeenCalled();
    expect(await new RecipeRetriever(db, { ...makeConfig(8), model: "another-model" }).indexRecipes(recipes))
      .toEqual({ embedded: 3, reused: 0 });
    expect(spy).toHaveBeenCalledTimes(3);
    db.close();
  });

  it("索引后召回返回已索引菜谱，按距离升序", async () => {
    mockFetchEmbed(8);
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, makeConfig(8));
    const recipes = store.getRecipeBook().slice(0, 3);
    await retriever.indexRecipes(recipes);

    const result = await retriever.recall("随便什么查询", 2);
    expect(result.recipes.length).toBeLessThanOrEqual(2);
    expect(result.recipes.every((r) => recipes.some((s) => s.id === r.id))).toBe(true);
    for (let i = 1; i < result.hits.length; i++) {
      expect(result.hits[i].score).toBeLessThanOrEqual(result.hits[i - 1].score);
    }
    db.close();
  });

  it("增量索引：未变更菜谱复用向量，不重新 embed", async () => {
    const spy = mockFetchEmbed(8);
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, makeConfig(8));
    const recipes = store.getRecipeBook().slice(0, 3);

    const r1 = await retriever.indexRecipes(recipes);
    expect(r1.embedded).toBe(3);
    expect(r1.reused).toBe(0);
    const callsAfterFirst = spy.mock.calls.length;

    const r2 = await retriever.indexRecipes(recipes); // 完全相同
    expect(r2.embedded).toBe(0);
    expect(r2.reused).toBe(3);
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // 没有新的 embed 调用
    db.close();
  });

  it("索引中途失败时只提交已成功写入菜谱的 hash", async () => {
    const db = new Database(":memory:");
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      if (calls > 1) throw new Error("embedding temporarily unavailable");
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0, 0, 0, 0, 0, 0] }] }), { status: 200 });
    });
    const retriever = new RecipeRetriever(db, makeConfig(8));
    const recipes = store.getRecipeBook().slice(0, 2);

    await expect(retriever.indexRecipes(recipes)).rejects.toThrow(/temporarily unavailable/);
    const row = db.prepare("SELECT value FROM rag_meta WHERE key = 'text_hashes'").get() as
      | { value: string }
      | undefined;
    const hashes = row ? JSON.parse(row.value) as Record<string, string> : {};
    expect(Object.keys(hashes)).toEqual([recipes[0].id]);
    db.close();
  });

  it("维度不匹配触发重建（drop 旧表，可容纳新维度向量）", async () => {
    mockFetchEmbed(8);
    const db = new Database(":memory:");
    await new RecipeRetriever(db, makeConfig(8)).indexRecipes(store.getRecipeBook().slice(0, 2));

    // 切换到 16 维：构造时应 drop 旧的 8 维 vec_recipes 表，否则插 16 维会报维度错误
    mockFetchEmbed(16);
    const retriever16 = new RecipeRetriever(db, { ...makeConfig(16), dim: 16 });
    await retriever16.indexRecipes(store.getRecipeBook().slice(0, 2));

    const meta = db.prepare("SELECT value FROM rag_meta WHERE key = 'embedding_meta'").get() as
      | { value: string }
      | undefined;
    expect(meta).toBeTruthy();
    expect(JSON.parse(meta!.value).dim).toBe(16);
    db.close();
  });
});

describe("search_recipes RAG 集成", () => {
  beforeEach(() => {
    _resetRetrieverForTests();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("EMBEDDING_PROVIDER=off 时仅 FTS5 关键词通道（向量关闭，不触发本地模型下载）", async () => {
    process.env.EMBEDDING_PROVIDER = "off";
    const userId = freshUser("rag_off");
    store.clearUserData(userId);
    const result = await searchRecipesTool.execute(
      "test-off",
      { userId, query: "鸡腿" },
      undefined,
      undefined,
      EMPTY_EXTENSION_CONTEXT
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("菜谱候选");
    const retriever = await getRetriever();
    expect(retriever).not.toBeNull(); // FTS5 通道可用
    expect(retriever!.backends.fts).toBe(true);
    expect(retriever!.backends.vector).toBeNull(); // off → 向量关闭
  });
});
