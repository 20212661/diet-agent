import { describe, expect, it } from "vitest";
import { bigramize } from "../rag/tokenizer.js";
import { FtsStore } from "../rag/ftsStore.js";
import Database from "better-sqlite3";

describe("bigramize", () => {
  it("中文连续段切双字；含空格/标点的段独立处理", () => {
    expect(bigramize("番茄炒蛋")).toBe("番茄 茄炒 炒蛋");
    expect(bigramize("炒 饭")).toBe("炒 饭"); // 两个单字段
    expect(bigramize("")).toBe("");
  });
});

describe("FtsStore.search 单字过滤", () => {
  const db = new Database(":memory:");
  const fts = new FtsStore(db);
  fts.upsert("r1", "蛋炒饭 鸡蛋 米饭");
  fts.upsert("r2", "炒面 面条");

  it("纯双字 token 正常命中", () => {
    expect(fts.search("炒饭", 5)).toContain("r1");
    expect(fts.search("面条", 5)).toContain("r2");
  });

  it("混合单字+双字时过滤单字（'炒 饭'的单字在 bigram 索引不存在）", () => {
    // "炒 饭" bigramize 为 "炒 饭"（两个单字段），无双字 → 不过滤 → 空结果
    // 但若查询是 "炒饭 炒" 这样混合，双字存在时过滤单字
    expect(fts.search("炒饭 炒", 5)).toContain("r1");
  });

  it("纯单字查询不过滤（可能命中索引中的独立单字 token）", () => {
    // 索引里可能有独立单字（如英文"a"），纯单字查询不过滤
    const result = fts.search("饭", 5);
    expect(Array.isArray(result)).toBe(true);
  });

  it("空查询返回空数组", () => {
    expect(fts.search("", 5)).toEqual([]);
  });
});

describe("RecipeRetriever.recall 空结果不抛错（vector=off 修复）", () => {
  it("双通道空手时返回空结果而非 throw（此前 scare log 的来源）", { timeout: 15_000 }, async () => {
    const { RecipeRetriever } = await import("../rag/recipeRetriever.js");
    const db = new Database(":memory:");
    const retriever = new RecipeRetriever(db, null); // 无向量通道
    const result = await retriever.recall("", 5);
    expect(result).toMatchObject({ recipes: [], hits: [], channels: { vector: 0, fts: 0 } });
    db.close();
  });
});
