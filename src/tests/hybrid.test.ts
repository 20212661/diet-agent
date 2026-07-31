import { describe, it, expect, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { EmbeddingConfig } from "../rag/embeddingAdapter.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { bigramize } = await import("../rag/tokenizer.js");
const { reciprocalRankFusion } = await import("../rag/rrf.js");
const { FtsStore } = await import("../rag/ftsStore.js");
const { RecipeRetriever } = await import("../rag/recipeRetriever.js");

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

describe("bigramize", () => {
  it("中文切成相邻双字", () => {
    expect(bigramize("番茄炒蛋")).toBe("番茄 茄炒 炒蛋");
    expect(bigramize("番茄")).toBe("番茄");
  });
  it("单字保留", () => {
    expect(bigramize("蛋")).toBe("蛋");
  });
  it("空串", () => {
    expect(bigramize("")).toBe("");
  });
  it("按标点/空白分段", () => {
    expect(bigramize("番茄炒蛋，快手菜")).toBe("番茄 茄炒 炒蛋 快手 手菜");
  });
  it("英文也切双字", () => {
    expect(bigramize("hello")).toBe("he el ll lo");
  });
});

describe("reciprocalRankFusion", () => {
  it("两通道都靠前的 id 得分最高，分数符合公式", () => {
    const fused = reciprocalRankFusion([["x", "y", "z"], ["x", "z", "y"]], 60);
    expect(fused[0].id).toBe("x"); // 两通道都第 1
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 61);
  });
  it("两通道都命中的 id 高于只在一个通道的", () => {
    const fused = reciprocalRankFusion([["a", "b"], ["b", "c"]], 60);
    const score = Object.fromEntries(fused.map((f) => [f.id, f.score]));
    expect(score.b).toBeGreaterThan(score.a);
    expect(score.b).toBeGreaterThan(score.c);
  });
  it("按 score 降序", () => {
    const fused = reciprocalRankFusion([["a", "b", "c"], ["c", "a"]], 60);
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
    }
  });
});

describe("FtsStore", () => {
  it("中文 bigram 命中 + 排除不含词的菜谱", () => {
    const db = new Database(":memory:");
    const fts = new FtsStore(db);
    fts.upsert("r1", "番茄炒蛋 快手 咸鲜");
    fts.upsert("r2", "红烧肉 下饭 浓油赤酱");
    fts.upsert("r3", "番茄牛腩 炖菜");
    const hits = fts.search("番茄", 5);
    expect(hits).toContain("r1");
    expect(hits).toContain("r3");
    expect(hits).not.toContain("r2");
    db.close();
  });

  it("upsert 幂等（同 id 不重复）", () => {
    const db = new Database(":memory:");
    const fts = new FtsStore(db);
    fts.upsert("r1", "番茄炒蛋");
    fts.upsert("r1", "番茄炒蛋");
    expect(fts.size()).toBe(1);
    db.close();
  });

  it("空查询 / 纯标点查询返回空", () => {
    const db = new Database(":memory:");
    const fts = new FtsStore(db);
    fts.upsert("r1", "番茄炒蛋");
    expect(fts.search("", 5)).toEqual([]);
    expect(fts.search("!!!", 5)).toEqual([]);
    db.close();
  });
});

describe("RecipeRetriever hybrid", () => {
  afterEach(() => vi.restoreAllMocks());

  it("双通道都可用 → RRF 融合，不抛错", async () => {
    mockFetchEmbed(8);
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, makeConfig(8));
    const recipes = store.getRecipeBook().slice(0, 5);
    await retriever.indexRecipes(recipes);

    const query = recipes[0].ingredients[0] ?? "菜";
    const result = await retriever.recall(query, 3);
    expect(result.recipes.length).toBeGreaterThan(0);
    expect(result.channels.vector).toBeGreaterThan(0);
    expect(retriever.backends.vector).toBe("sqlite-vec");
    expect(retriever.backends.fts).toBe(true);
    db.close();
  });

  it("recall 时向量通道失败 → 关键词单通道降级", async () => {
    const spy = mockFetchEmbed(8); // index 阶段正常
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, makeConfig(8));
    const recipes = store.getRecipeBook().slice(0, 3);
    await retriever.indexRecipes(recipes);

    spy.mockRejectedValue(new Error("HTTP 500")); // recall 阶段 embed 失败
    const query = recipes[0].ingredients[0] ?? "菜";
    const result = await retriever.recall(query, 3);
    expect(result.channels.vector).toBe(0);
    expect(result.channels.fts).toBeGreaterThan(0); // fts 仍工作
    expect(result.recipes.length).toBeGreaterThan(0);
    db.close();
  });

  it("无 embedding config → 仅 FTS5 关键词通道", async () => {
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, null); // 无向量通道
    const recipes = store.getRecipeBook().slice(0, 3);
    await retriever.indexRecipes(recipes);

    const query = recipes[0].ingredients[0] ?? "菜";
    const result = await retriever.recall(query, 3);
    expect(result.channels.vector).toBe(0);
    expect(result.channels.fts).toBeGreaterThan(0);
    expect(retriever.backends.vector).toBeNull();
    expect(retriever.backends.fts).toBe(true);
    db.close();
  });
});
