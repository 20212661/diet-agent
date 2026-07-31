/**
 * 菜谱语义检索编排层（retrieve 阶段）。
 *
 * 负责：
 *  - 增量索引：只对「文本变更或向量缺失」的菜谱调 embedding API（省钱）
 *  - 语义召回：embed(query) → 向量 KNN → 映射回 RecipeRecord[]
 *  - 维度切换重建：换 embedding provider（1024↔1536）时 drop 旧向量表重建
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

export interface RecallResult {
  recipes: RecipeRecord[];
  hits: Array<{ id: string; distance: number }>;
}

export class RecipeRetriever {
  readonly config: EmbeddingConfig;
  private readonly vectors: VectorStore;
  private readonly textHashes = new Map<string, string>();
  private readonly db: Database.Database;

  constructor(db: Database.Database, config: EmbeddingConfig) {
    this.db = db;
    this.config = config;

    // 维度/provider 切换检测：与历史记录不一致 → drop 向量表 + 清 hash，强制重建
    const prev = loadEmbeddingMeta(db);
    if (prev && (prev.dim !== config.dim || prev.provider !== config.provider)) {
      console.warn(
        `[RAG] embedding changed ${prev.provider}/${prev.dim} → ${config.provider}/${config.dim}, rebuilding vector index`
      );
      db.exec("DROP TABLE IF EXISTS vec_recipes");
      this.clearTextHashes();
    }

    this.vectors = createVectorStore(db, config.dim);
    this.loadTextHashes();
  }

  /** 增量索引：只 embed 文本变更或向量缺失的菜谱，未变的复用旧向量。 */
  async indexRecipes(recipes: RecipeRecord[]): Promise<{ embedded: number; reused: number }> {
    const tasks: Array<{ id: string; text: string }> = [];
    for (const r of recipes) {
      const text = buildRecipeText(r);
      const hash = hashRecipeText(text);
      if (this.textHashes.get(r.id) === hash && this.vectors.has(r.id)) {
        continue; // 文本未变且向量还在 → 复用
      }
      tasks.push({ id: r.id, text });
      this.textHashes.set(r.id, hash);
    }

    let embedded = 0;
    for (const t of tasks) {
      const { vector } = await embed(t.text, this.config);
      this.vectors.upsert(t.id, vector);
      this.saveTextHashes(); // 每条 embed 后落盘，崩溃可恢复
      embedded++;
    }
    saveEmbeddingMeta(this.db, this.config);

    return { embedded, reused: recipes.length - tasks.length };
  }

  /**
   * 语义召回 top-K 菜谱。
   * embed 失败时抛错，由调用方（searchRecipes）降级到全量 matcher。
   */
  async recall(query: string, topK: number): Promise<RecallResult> {
    const { vector } = await embed(query, this.config);
    const hits = this.vectors.knn(vector, topK);
    const idSet = new Set(hits.map((h) => h.id));
    const recipes = store.getRecipeBook().filter((r) => idSet.has(r.id));
    return { recipes, hits };
  }

  isAvailable(): boolean {
    return this.vectors.size() > 0;
  }

  get backend(): string {
    return this.vectors.backend;
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
      // 损坏的 hash 直接忽略，最坏情况是重新 embed 一次
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
 * 获取 RAG 检索器单例（懒加载，首次调用时索引菜谱）。
 * 返回 null 表示 RAG 不可用（无 embedding key 或初始化失败），调用方应退回纯 matcher。
 */
export function getRetriever(): Promise<RecipeRetriever | null> {
  if (_retrieverPromise) return _retrieverPromise;
  _retrieverPromise = (async () => {
    const config = resolveEmbeddingConfig();
    if (!config) return null; // 未配置 embedding key → RAG 关闭

    try {
      const retriever = new RecipeRetriever(store.getDatabase(), config);
      const { embedded, reused } = await retriever.indexRecipes(store.getRecipeBook());
      console.log(
        `[RAG] indexed: embedded=${embedded} reused=${reused} backend=${retriever.backend} dim=${config.dim}`
      );
      return retriever;
    } catch (e) {
      console.warn(`[RAG] retriever init failed (${(e as Error).message}), RAG disabled`);
      return null;
    }
  })();
  return _retrieverPromise;
}

/** 测试用：重置单例（每个测试用例需独立 retriever）。 */
export function _resetRetrieverForTests(): void {
  _retrieverPromise = undefined;
}
