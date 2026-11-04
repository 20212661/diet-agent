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

/** 召回范围（用户隔离）：全局库 + 该用户自己的导入；其他用户的菜不在集合里。 */
export interface RecallScope {
  recipes: RecipeRecord[];
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
      if (prev && (prev.dim !== config.dim || prev.provider !== config.provider || prev.model !== config.model)) {
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
      console.warn(`[RAG] FTS5 unavailable (errorType=${e instanceof Error ? e.name : typeof e}), keyword channel disabled`);
      this.fts = null;
    }

    this.loadTextHashes();
  }

  /** 增量索引：文本未变且相关通道已有则复用，否则 embed + fts upsert。 */
  async indexRecipes(recipes: RecipeRecord[]): Promise<{ embedded: number; reused: number }> {
    const tasks: Array<{ id: string; text: string; hash: string }> = [];
    for (const r of recipes) {
      const text = buildRecipeText(r);
      const hash = hashRecipeText(text);
      const vectorHas = this.vectors?.has(r.id) ?? false;
      const ftsHas = this.fts?.has(r.id) ?? false;
      const allChannelsHave = (!this.vectors || vectorHas) && (!this.fts || ftsHas);
      if (this.textHashes.get(r.id) === hash && allChannelsHave) {
        continue; // 文本未变且所有存在的通道都有 → 复用
      }
      // 只有所有实际通道都成功写入后，才能提交 hash。提前写入会在
      // embedding/FTS 中途失败时把旧索引误标成最新版本。
      tasks.push({ id: r.id, text, hash });
    }

    let embedded = 0;
    for (const t of tasks) {
      if (this.vectors && this.config) {
        const { vector } = await embed(t.text, this.config);
        this.vectors.upsert(t.id, vector);
      }
      this.fts?.upsert(t.id, t.text); // 本地 SQL，无 API 成本
      this.textHashes.set(t.id, t.hash);
      this.saveTextHashes();
      embedded++;
    }
    if (this.config) saveEmbeddingMeta(this.db, this.config);

    return { embedded, reused: recipes.length - tasks.length };
  }

  /** hybrid 召回：双通道并发 + RRF 融合（或单通道降级）。 */
  async recall(query: string, topK: number, scope?: RecallScope): Promise<RecallResult> {
    // 用户隔离：scope 限定该用户可见的菜谱（全局库 + 自己导入）。
    // 通道取全量再过滤（库量级几百，KNN 全扫无压力），保证过滤后排名正确。
    const allowedIds = scope ? new Set(scope.recipes.map((r) => r.id)) : null;
    const fetchN = scope
      ? Math.max(RECALL_N, this.vectors?.size() ?? 0, this.fts?.size() ?? 0)
      : RECALL_N;

    const vectorPromise = this.vectors && this.config
      ? this.recallVector(query, fetchN).catch((e: unknown) => {
          console.warn(`[RAG] vector channel failed (errorType=${e instanceof Error ? e.name : typeof e})`);
          return [] as string[];
        })
      : Promise.resolve([] as string[]);

    const ftsPromise = this.fts
      ? new Promise<string[]>((resolve) => {
          try {
            resolve(this.fts!.search(query, fetchN));
          } catch (e) {
            console.warn(`[RAG] fts channel failed (errorType=${e instanceof Error ? e.name : typeof e})`);
            resolve([]);
          }
        })
      : Promise.resolve([] as string[]);

    const [vectorIdsAll, ftsIdsAll] = await Promise.all([vectorPromise, ftsPromise]);
    const vectorIds = allowedIds ? vectorIdsAll.filter((id) => allowedIds.has(id)) : vectorIdsAll;
    const ftsIds = allowedIds ? ftsIdsAll.filter((id) => allowedIds.has(id)) : ftsIdsAll;

    const channelLists: string[][] = [];
    if (vectorIds.length > 0) channelLists.push(vectorIds);
    if (ftsIds.length > 0) channelLists.push(ftsIds);

    if (channelLists.length === 0) {
      // 双通道空手而归：返回空结果（调用方退回关键词预筛），不抛错——
      // vector=off 时 FTS 对特定查询（纯单字/空串）返回空是正常路径，
      // 抛错会让调用方打 scare log 并走 catch 降级分支，浪费且混淆。
      return { recipes: [], hits: [], channels: { vector: 0, fts: 0 } };
    }

    const fused = reciprocalRankFusion(channelLists, RRF_K).slice(0, topK);
    const idSet = new Set(fused.map((f) => f.id));
    // 水合来源：scope 时用调用方给的菜谱集（该用户可见），否则全局库
    const recipes = (scope?.recipes ?? store.getRecipeBook()).filter((r) => idSet.has(r.id));

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

/** 共享索引的候选全集：全局库 + 所有用户的导入（查询时按 scope 过滤到可见集合）。 */
function indexedRecipeUniverse(): RecipeRecord[] {
  return [...store.getRecipeBook(), ...store.getAllUserRecipes()];
}

/**
 * 获取 hybrid 检索器单例（懒加载，首次调用时索引菜谱）。
 * 向量通道需要 embedding key；FTS5 关键词通道不需要 key。
 * local embedding 加载失败（未安装/离线/下载失败）时打一行原因并退回纯 FTS，
 * 不报错、不阻塞启动。两通道都不可用时返回 null（调用方退回纯 matcher）。
 */
export function getRetriever(): Promise<RecipeRetriever | null> {
  if (_retrieverPromise) return _retrieverPromise;
  _retrieverPromise = (async () => {
    const config = resolveEmbeddingConfig(); // 可能 null（EMBEDDING_PROVIDER=off）
    if (config?.provider === "local") {
      // local embedding 优先尝试索引；失败（未安装/离线/下载失败）退回纯 FTS
      try {
        const retriever = new RecipeRetriever(store.getDatabase(), config);
        const { embedded, reused } = await retriever.indexRecipes(indexedRecipeUniverse());
        const b = retriever.backends;
        console.log(
          `[RAG] indexed: embedded=${embedded} reused=${reused} | vector=${b.vector ?? "off"} fts=${b.fts ? "on" : "off"}`
        );
        return retriever.isAvailable() ? retriever : null;
      } catch (e) {
        // 提取可读原因（localEmbedder 的错误消息已含说明），打一行退回纯 FTS
        const reason = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
        console.log(`[RAG] local embedding 不可用（${reason}），退回纯 FTS5 关键词通道`);
        // 不 return null——FTS 仍然可用，构建无向量通道的 retriever
      }
    }
    // 纯 FTS（EMBEDDING_PROVIDER=off 或 local 加载失败退回）
    try {
      const retriever = new RecipeRetriever(store.getDatabase(), null);
      await retriever.indexRecipes(indexedRecipeUniverse());
      if (!retriever.isAvailable()) {
        console.warn("[RAG] no recall channel available, RAG disabled");
        return null;
      }
      return retriever;
    } catch (e) {
      console.warn(`[RAG] retriever init failed (errorType=${e instanceof Error ? e.name : typeof e}), RAG disabled`);
      return null;
    }
  })();
  return _retrieverPromise;
}

/** 用户导入后增量索引一条（best-effort：失败只打日志，不影响已完成的入库）。 */
export async function indexRecipeIncrementally(recipe: RecipeRecord): Promise<void> {
  try {
    const retriever = await getRetriever();
    if (!retriever) return;
    await retriever.indexRecipes([recipe]);
  } catch (e) {
    console.warn(`[RAG] incremental index failed (errorType=${e instanceof Error ? e.name : typeof e})`);
  }
}

/**
 * 从共享索引中移除菜谱（用户删除数据时用）。直接 SQL，不依赖单例是否已建；
 * vec0/fts5 虚拟表都支持 DELETE。若单例已用内存向量回退，其内存副本可能残留到
 * 进程重启——隔离由查询侧 scope 过滤保证，残留只是多余候选，不会泄露给其他用户。
 */
export function deleteRecipeIndexEntries(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    const db = store.getDatabase();
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM fts_recipes WHERE id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM vec_recipes WHERE id IN (${placeholders})`).run(...ids);
    const row = db.prepare("SELECT value FROM rag_meta WHERE key = 'text_hashes'").get() as { value: string } | undefined;
    if (row) {
      const hashes = JSON.parse(row.value) as Record<string, string>;
      let changed = false;
      for (const id of ids) if (id in hashes) { delete hashes[id]; changed = true; }
      if (changed) {
        db.prepare("UPDATE rag_meta SET value = ? WHERE key = 'text_hashes'").run(JSON.stringify(hashes));
      }
    }
  } catch (e) {
    console.warn(`[RAG] index cleanup failed (errorType=${e instanceof Error ? e.name : typeof e})`);
  }
}

/** 测试用：重置单例。 */
export function _resetRetrieverForTests(): void {
  _retrieverPromise = undefined;
}
