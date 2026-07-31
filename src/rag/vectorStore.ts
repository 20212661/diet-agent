/**
 * 向量存储：抽象接口 + sqlite-vec 实现 + 内存余弦 fallback + 工厂。
 *
 * 关键设计：所有向量都先归一化（见 embeddingAdapter.normalize）。
 * 归一化后，sqlite-vec 的 L2 距离与余弦相似度单调等价，
 * 因此两个实现的 KNN 排序一致，可透明互换。
 *
 * 工厂优先 sqlite-vec；扩展加载/建表/自检任一失败则回退内存，保证功能不丢。
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface KnnHit {
  id: string;
  /** sqlite-vec: L2 距离（升序）；memory: 1 - 余弦（升序）。两者同向，仅用于日志/调试。 */
  distance: number;
}

export interface VectorStore {
  readonly backend: "sqlite-vec" | "memory";
  readonly dim: number;
  upsert(id: string, vector: number[]): void;
  knn(query: number[], k: number): KnnHit[];
  has(id: string): boolean;
  clear(): void;
  size(): number;
}

// ---------------- 内存实现（归一化向量的余弦 = 点积） ----------------

export class InMemoryVecStore implements VectorStore {
  readonly backend = "memory" as const;
  private vectors = new Map<string, number[]>();

  constructor(readonly dim: number) {}

  upsert(id: string, vector: number[]): void {
    this.vectors.set(id, vector);
  }

  has(id: string): boolean {
    return this.vectors.has(id);
  }

  clear(): void {
    this.vectors.clear();
  }

  size(): number {
    return this.vectors.size;
  }

  knn(query: number[], k: number): KnnHit[] {
    const hits: KnnHit[] = [];
    for (const [id, vec] of this.vectors) {
      // 归一化向量的余弦相似度 = 点积；distance = 1 - cos（越小越相似，与 L2 同向）
      let dot = 0;
      for (let i = 0; i < vec.length; i++) dot += vec[i] * query[i];
      hits.push({ id, distance: 1 - dot });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, k);
  }
}

// ---------------- sqlite-vec 实现 ----------------

const VEC_TABLE = "vec_recipes";

export class SqliteVecStore implements VectorStore {
  readonly backend = "sqlite-vec" as const;

  constructor(
    private db: Database.Database,
    readonly dim: number
  ) {
    sqliteVec.load(this.db);
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(id text primary key, embedding float[${dim}])`
    );
  }

  upsert(id: string, vector: number[]): void {
    // vec0 主键无 ON CONFLICT，先删后插
    this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE id = ?`).run(id);
    this.db.prepare(`INSERT INTO ${VEC_TABLE} (id, embedding) VALUES (?, ?)`).run(id, new Float32Array(vector));
  }

  has(id: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM ${VEC_TABLE} WHERE id = ? LIMIT 1`).get(id);
    return !!row;
  }

  clear(): void {
    this.db.exec(`DELETE FROM ${VEC_TABLE}`);
  }

  size(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${VEC_TABLE}`).get() as { n: number };
    return row.n;
  }

  knn(query: number[], k: number): KnnHit[] {
    const rows = this.db
      .prepare(`SELECT id, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`)
      .all(new Float32Array(query), k) as Array<{ id: string; distance: number }>;
    return rows.map((r) => ({ id: r.id, distance: r.distance }));
  }

  /** 维度切换时显式 drop 表（retriever 负责） */
  dropTable(): void {
    this.db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
  }
}

/**
 * 工厂：优先 sqlite-vec；load / 建表 / 自检（插探测向量 + KNN）任一失败则回退内存。
 * 自检确保扩展真正可用——load 成功 ≠ vec0 可用。
 */
export function createVectorStore(db: Database.Database, dim: number): VectorStore {
  try {
    const store = new SqliteVecStore(db, dim);
    const probe = unitVector(dim);
    store.upsert(SELFTEST_ID, probe);
    const hit = store.knn(probe, 1);
    store.clear(); // 清掉自检数据，留给 retriever 从干净状态索引
    if (!hit.some((h) => h.id === SELFTEST_ID)) {
      throw new Error("self-test KNN did not return the probe vector");
    }
    console.log(`[RAG] vector store: sqlite-vec (dim=${dim})`);
    return store;
  } catch (e) {
    console.warn(
      `[RAG] sqlite-vec unavailable (${(e as Error).message}), falling back to in-memory vectors`
    );
    console.log(`[RAG] vector store: in-memory (dim=${dim})`);
    return new InMemoryVecStore(dim);
  }
}

const SELFTEST_ID = "__rag_selftest__";

function unitVector(dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[0] = 1;
  return v;
}
