/**
 * 菜谱 hybrid 检索编排层（retrieve 阶段）。
 *
 * 双通道：
 *  - 向量通道（dense）：sqlite-vec KNN，抓语义（"清爽夏日菜"）
 *  - 关键词通道（sparse）：FTS5 BM25，抓精确命中（"番茄"）
 * 两通道各取 top-N 排序，RRF 融合（只看排名）取 top-K。
 *
 * 降级矩阵：任一通道失败用单通道；都失败抛错让 searchRecipes 退回全量 matcher。
 * 无 embedding key 时向量通道关闭，但 FTS5 关键词通道仍工作（升级，非回归）。
 *
 * 精排和安全过滤（忌口 -999 等）不在这里——仍由 recipeMatcher 负责。
 */
import Database from "better-sqlite3";
import type { RecipeRecord } from "../types/diet.js";
import * as store from "../store/index.js";
import { buildRecipeText, hashRecipeText } from "./buildRecipeText.js";
import {
  embed,
  resolveEmbeddingConfig,
  loadEmbeddingMeta,
  saveEmbeddingMeta,
  type EmbeddingConfig,
} from "./embeddingAdapter.js";
import { createVectorStore, type VectorStore } from "./vectorStore.js";
import { FtsStore } from "./ftsStore.js";
import { reciprocalRankFusion } from "./rrf.js";

/** 每个通道召回的候选数（融合前），融合后再取 topK */
const RECALL_N = 50;
/** RRF 常数 k（业界经验值） */
const RRF_K = 60;

export interface RecallResult {
  recipes: RecipeRecord[];
  hits: Array<{ id: string; score: number }>; // RRF 融合分（降序）
  channels: { vector: number; fts: number }; // 各通道命中数（日志/调试）
}

export class RecipeRetriever {
  readonly config: EmbeddingConfig | null;
  private readonly vectors: VectorStore | null;
  private readonly fts: FtsStore | null;
  private readonly textHashes = new Map<string, string>();
  private readonly db: Database.Database;

  constructor(db: Database.Database, config: EmbeddingConfig | null) {
    this.db = db;
    this.config = config;

    // rag_meta 存 embedding 维度 + 文本 hash；无 embedding config 时也要建，供 textHashes 持久化
    this.db.exec("CREATE TABLE IF NOT EXISTS rag_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    // 维度/provider 切换检测（仅向量通道相关）：不一致则 drop 向量表 + 清 hash
    if (config) {
      const prev = loadEmbeddingMeta(db);
      if (prev && (prev.dim !== config.dim || prev.provider !== config.provider)) {
        console.warn(
          `[RAG] embedding changed ${prev.provider}/${prev.dim} → ${config.provider}/${config.dim}, rebuilding vector index`
        );
        db.exec("DROP TABLE IF EXISTS vec_recipes");
        this.clearTextHashes();
      }
    }

    // 向量通道（有 embedding config 才建）
    this.vectors = config ? createVectorStore(db, config.dim) : null;

    // 关键词通道（FTS5 内置，几乎必可用；失败则禁用）
    try {
      this.fts = new FtsStore(db);
    } catch (e) {
      console.warn(`[RAG] FTS5 unavailable (${(e as Error).message}), keyword channel disabled`);
      this.fts = null;
    }

    this.loadTextHashes();
  }

  /** 增量索引：文本未变且相关通道已有则复用，否则 embed + fts upsert。 */
  async indexRecipes(recipes: RecipeRecord[]): Promise<{ embedded: number; reused: number }> {
    const tasks: Array<{ id: string; text: string }> = [];
    for (const r of recipes) {
      const text = buildRecipeText(r);
      const hash = hashRecipeText(text);
      const vectorHas = this.vectors?.has(r.id) ?? false;
      const ftsHas = this.fts?.has(r.id) ?? false;
      const allChannelsHave = (!this.vectors || vectorHas) && (!this.fts || ftsHas);
      if (this.textHashes.get(r.id) === hash && allChannelsHave) {
        continue; // 文本未变且所有存在的通道都有 → 复用
      }
      tasks.push({ id: r.id, text });
      this.textHashes.set(r.id, hash);
    }

    let embedded = 0;
    for (const t of tasks) {
      if (this.vectors && this.config) {
        const { vector } = await embed(t.text, this.config);
        this.vectors.upsert(t.id, vector);
      }
      this.fts?.upsert(t.id, t.text); // 本地 SQL，无 API 成本
      this.saveTextHashes();
      embedded++;
    }
    if (this.config) saveEmbeddingMeta(this.db, this.config);

    return { embedded, reused: recipes.length - tasks.length };
  }

  /** hybrid 召回：双通道并发 + RRF 融合（或单通道降级）。 */
  async recall(query: string, topK: number): Promise<RecallResult> {
    const vectorPromise = this.vectors && this.config
      ? this.recallVector(query, RECALL_N).catch((e: unknown) => {
          console.warn(`[RAG] vector channel failed: ${(e as Error).message}`);
          return [] as string[];
        })
      : Promise.resolve([] as string[]);

    const ftsPromise = this.fts
      ? new Promise<string[]>((resolve) => {
          try {
            resolve(this.fts!.search(query, RECALL_N));
          } catch (e) {
            console.warn(`[RAG] fts channel failed: ${(e as Error).message}`);
            resolve([]);
          }
        })
      : Promise.resolve([] as string[]);

    const [vectorIds, ftsIds] = await Promise.all([vectorPromise, ftsPromise]);

    const channelLists: string[][] = [];
    if (vectorIds.length > 0) channelLists.push(vectorIds);
    if (ftsIds.length > 0) channelLists.push(ftsIds);

    if (channelLists.length === 0) {
      throw new Error("all recall channels empty");
    }

    const fused = reciprocalRankFusion(channelLists, RRF_K).slice(0, topK);
    const idSet = new Set(fused.map((f) => f.id));
    const recipes = store.getRecipeBook().filter((r) => idSet.has(r.id));

    return {
      recipes,
      hits: fused.map((f) => ({ id: f.id, score: f.score })),
      channels: { vector: vectorIds.length, fts: ftsIds.length },
    };
  }

  private async recallVector(query: string, n: number): Promise<string[]> {
    if (!this.vectors || !this.config) return [];
    const { vector } = await embed(query, this.config);
    return this.vectors.knn(vector, n).map((h) => h.id);
  }

  isAvailable(): boolean {
    return (this.vectors?.size() ?? 0) > 0 || (this.fts?.size() ?? 0) > 0;
  }

  get backends(): { vector: string | null; fts: boolean } {
    return { vector: this.vectors?.backend ?? null, fts: !!this.fts };
  }

  // ---- textHashes 持久化（复用 rag_meta 表，key=text_hashes）----

  private loadTextHashes(): void {
    const row = this.db.prepare("SELECT value FROM rag_meta WHERE key = ?").get("text_hashes") as
      | { value: string }
      | undefined;
    if (!row) return;
    try {
      const obj = JSON.parse(row.value) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) this.textHashes.set(k, v);
    } catch {
      // 损坏的 hash 直接忽略，最坏情况是重新 embed/index 一次
    }
  }

  private saveTextHashes(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.textHashes) obj[k] = v;
    this.db
      .prepare(
        "INSERT INTO rag_meta (key, value) VALUES ('text_hashes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(JSON.stringify(obj));
  }

  private clearTextHashes(): void {
    this.textHashes.clear();
    this.db.prepare("DELETE FROM rag_meta WHERE key = 'text_hashes'").run();
  }
}

// ---------------- 单例 ----------------

let _retrieverPromise: Promise<RecipeRetriever | null> | undefined;

/**
 * 获取 hybrid 检索器单例（懒加载，首次调用时索引菜谱）。
 * 向量通道需要 embedding key；FTS5 关键词通道不需要 key。
 * 两通道都不可用时返回 null（调用方退回纯 matcher）。
 */
export function getRetriever(): Promise<RecipeRetriever | null> {
  if (_retrieverPromise) return _retrieverPromise;
  _retrieverPromise = (async () => {
    const config = resolveEmbeddingConfig(); // 可能 null（无 embedding key）
    try {
      const retriever = new RecipeRetriever(store.getDatabase(), config ?? null);
      const { embedded, reused } = await retriever.indexRecipes(store.getRecipeBook());
      const b = retriever.backends;
      console.log(
        `[RAG] indexed: embedded=${embedded} reused=${reused} | vector=${b.vector ?? "off"} fts=${b.fts ? "on" : "off"}`
      );
      if (!retriever.isAvailable()) {
        console.warn("[RAG] no recall channel available, RAG disabled");
        return null;
      }
      return retriever;
    } catch (e) {
      console.warn(`[RAG] retriever init failed (${(e as Error).message}), RAG disabled`);
      return null;
    }
  })();
  return _retrieverPromise;
}

/** 测试用：重置单例。 */
export function _resetRetrieverForTests(): void {
  _retrieverPromise = undefined;
}
