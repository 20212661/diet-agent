/**
 * FTS5 关键词召回通道（sparse / BM25）。
 *
 * 与 vectorStore.ts 的 SqliteVecStore 对称：一个 vec0 虚拟表（向量），
 * 一个 fts5 虚拟表（关键词），都在同一个 SQLite 库里。
 *
 * 中文处理：content 存的是 bigramize 后的文本（空格分隔双字），
 * tokenize='unicode61' 按空格分词即可正常工作（见 tokenizer.ts）。
 */
import Database from "better-sqlite3";
import { bigramize } from "./tokenizer.js";

const FTS_TABLE = "fts_recipes";

export class FtsStore {
  constructor(private db: Database.Database) {
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(id UNINDEXED, content, tokenize='unicode61')`
    );
  }

  /** 写入/更新一条菜谱的检索文本（先删后插，FTS5 无 ON CONFLICT）。 */
  upsert(id: string, text: string): void {
    this.db.prepare(`DELETE FROM ${FTS_TABLE} WHERE id = ?`).run(id);
    this.db.prepare(`INSERT INTO ${FTS_TABLE} (id, content) VALUES (?, ?)`).run(id, bigramize(text));
  }

  /**
   * 关键词召回：返回按 bm25 升序（越相关越靠前）的 id 列表。
   * 查询用 OR 拼接 bigram tokens 以扩大召回，相关性交给 bm25 排序。
   */
  search(query: string, k: number): string[] {
    const tokens = bigramize(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const matchExpr = tokens.join(" OR ");
    const rows = this.db
      .prepare(`SELECT id FROM ${FTS_TABLE} WHERE content MATCH ? ORDER BY bm25(${FTS_TABLE}) LIMIT ?`)
      .all(matchExpr, k) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  has(id: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM ${FTS_TABLE} WHERE id = ? LIMIT 1`).get(id);
    return !!row;
  }

  clear(): void {
    this.db.exec(`DELETE FROM ${FTS_TABLE}`);
  }

  size(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${FTS_TABLE}`).get() as { n: number };
    return row.n;
  }

  /** 维度切换重建时用 */
  dropTable(): void {
    this.db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
  }
}
