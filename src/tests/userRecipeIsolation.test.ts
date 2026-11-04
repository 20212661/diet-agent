/**
 * 用户菜谱跨用户隔离（v23 user_recipes + 检索/匹配全链路 + 隐私三件套）。
 *
 * 关键性质：RAG 召回的 scope 过滤发生在 topK 截断**之前**（通道取全量→过滤→
 * RRF 融合→截断）——B 灌入大量与 A 查询高度相关的菜也不会挤占 A 的 topK。
 * 本文件不依赖导入管道（P5 ②）模块：记录直接手构后 upsertUserRecipe。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.DIET_AGENT_DB_PATH = ":memory:";
process.env.EMBEDDING_PROVIDER = "off";

const store = await import("../store/index.js");
const { deriveRecipeIngredientMetadata } = await import("../recipes/ingredientTaxonomy.js");
const { getRetriever, _resetRetrieverForTests } = await import("../rag/recipeRetriever.js");
const { searchRecipesTool } = await import("../tools/searchRecipes.js");
const { matchRecipes } = await import("../recipes/recipeMatcher.js");
const privacy = await import("../privacy/userData.js");
import type { RecipeRecord } from "../types/diet.js";

/** 手构一条可入库的用户菜谱（食材面经分类表派生，与管道产物同构）。 */
function makeRecord(id: string, name: string, ingredients: string[]): Omit<RecipeRecord, "updatedAt"> {
  const derived = deriveRecipeIngredientMetadata(ingredients);
  return {
    id, name,
    mode: "stovetop", modes: ["stovetop"], mealTypes: ["dinner"], suitableGoals: ["balanced"],
    ingredients, optionalIngredients: [], ingredientIds: derived.ingredientIds, allergenTags: derived.allergenTags,
    vegetables: [], staples: [], cookware: ["炒锅"], appliances: ["stove"],
    activeMinutes: 10, totalMinutes: 20, difficulty: 2, dishCount: 1,
    tasteTags: [], preferenceTags: [], steps: ["示例步骤"],
  };
}

describe("跨用户隔离：存储与检索", () => {
  beforeEach(() => { _resetRetrieverForTests(); });
  afterEach(() => { _resetRetrieverForTests(); });

  it("存储层：getRecipeBookForUser 只合并自己的导入", () => {
    const saved = store.upsertUserRecipe("userA", makeRecord("usr_iso_1", "外婆的私房手擀面", ["面条", "番茄", "鸡蛋"]));
    expect(store.getUserRecipes("userA").map((r) => r.id)).toContain(saved.id);
    expect(store.getUserRecipes("userB").map((r) => r.id)).not.toContain(saved.id);
    expect(store.getRecipeBookForUser("userA").some((r) => r.id === saved.id)).toBe(true);
    expect(store.getRecipeBookForUser("userB").some((r) => r.id === saved.id)).toBe(false);
  });

  it("RAG 与 search_recipes 工具：A 的私有菜只对 A 召回；B 搜同名也搜不到", async () => {
    const saved = store.upsertUserRecipe("iso_userA", makeRecord("usr_iso_2", "用户A私房蒜蓉粉丝蒸虾", ["大虾", "粉丝", "蒜", "生抽", "蚝油", "葱"]));
    const retriever = await getRetriever();
    expect(retriever).toBeTruthy();

    const aBook = store.getRecipeBookForUser("iso_userA");
    const bBook = store.getRecipeBookForUser("iso_userB");
    const aHits = (await retriever!.recall("蒜蓉粉丝蒸虾", 20, { recipes: aBook })).recipes.map((r) => r.id);
    const bHits = (await retriever!.recall("蒜蓉粉丝蒸虾", 20, { recipes: bBook })).recipes.map((r) => r.id);
    expect(aHits).toContain(saved.id);
    expect(bHits).not.toContain(saved.id);

    // 推荐路径（matchRecipes）同样按用户集合
    const bMatches = matchRecipes({
      recipes: bBook,
      availableIngredients: [],
      shoppingList: [],
      kitchenProfile: store.getKitchenProfile("iso_userB"),
      userProfile: undefined,
      feedback: [],
    });
    expect(bMatches.some((m) => m.recipe.id === saved.id)).toBe(false);

    // search_recipes 工具端到端（RAG 通道 + scope 过滤）
    const resultB = await searchRecipesTool.execute("t-iso-b", { userId: "iso_userB", query: "蒜蓉粉丝蒸虾", limit: 10 }, undefined, undefined, {} as never);
    expect(JSON.stringify(resultB.details)).not.toContain(saved.id);
    const resultA = await searchRecipesTool.execute("t-iso-a", { userId: "iso_userA", query: "蒜蓉粉丝蒸虾", limit: 10 }, undefined, undefined, {} as never);
    expect(JSON.stringify(resultA.details)).toContain(saved.id);
  });

  it("挤压测试：B 灌入 20 道与 A 查询高度相关的菜，A 仍拿满 topK 条自己可见的结果", async () => {
    // A 先有 10 道、B 后灌 20 道——若过滤发生在截断之后，B 的高相关同名变体
    // 会占满融合榜，A 过滤后拿不到满额；正确实现应过滤在前、A 稳定拿满 10 条。
    for (let i = 1; i <= 10; i++) {
      store.upsertUserRecipe("crowdA", makeRecord(`usrCrowdA${i}`, `蒜蓉粉丝蒸虾（私房${i}号）`, ["大虾", "粉丝", "蒜", "生抽"]));
    }
    for (let i = 1; i <= 20; i++) {
      store.upsertUserRecipe("crowdB", makeRecord(`usrCrowdB${i}`, `蒜蓉粉丝蒸虾（邻居${i}号）`, ["大虾", "粉丝", "蒜", "蚝油"]));
    }
    const retriever = await getRetriever();
    expect(retriever).toBeTruthy();

    const aBook = store.getRecipeBookForUser("crowdA");
    expect(aBook.filter((r) => r.id.startsWith("usrCrowdA"))).toHaveLength(10);

    const result = await retriever!.recall("蒜蓉粉丝蒸虾", 10, { recipes: aBook });
    // 拿满 topK，且全部在 A 的可见集合里
    expect(result.recipes).toHaveLength(10);
    const aBookIds = new Set(aBook.map((r) => r.id));
    expect(result.recipes.every((r) => aBookIds.has(r.id))).toBe(true);
    expect(result.recipes.some((r) => r.id.startsWith("usrCrowdB"))).toBe(false);

    // 反向也成立：B 拿满 10 条且不含 A 的
    const bBook = store.getRecipeBookForUser("crowdB");
    const resultB = await retriever!.recall("蒜蓉粉丝蒸虾", 10, { recipes: bBook });
    expect(resultB.recipes).toHaveLength(10);
    expect(resultB.recipes.every((r) => bBook.some((b) => b.id === r.id))).toBe(true);
    expect(resultB.recipes.some((r) => r.id.startsWith("usrCrowdA"))).toBe(false);
  });
});

describe("跨用户隔离：隐私三件套纳入用户菜谱", () => {
  beforeEach(() => { _resetRetrieverForTests(); });
  afterEach(() => { _resetRetrieverForTests(); });

  it("删除用户数据时，其菜谱与 RAG 索引条目一并移除；导出与概览包含用户菜谱", async () => {
    const saved = store.upsertUserRecipe("del_user", makeRecord("usr_del_1", "待删除私房菜", ["番茄", "鸡蛋"]));
    const retriever = await getRetriever();
    expect(retriever).toBeTruthy();
    const db = store.getDatabase();
    expect(db.prepare("SELECT 1 FROM fts_recipes WHERE id = ?").get(saved.id) as object | undefined).toBeTruthy();

    const result = privacy.deleteUserData("del_user", () => {});
    expect(result.databaseRows).toBeGreaterThan(0);
    expect(store.getUserRecipes("del_user")).toHaveLength(0);
    expect(db.prepare("SELECT 1 FROM fts_recipes WHERE id = ?").get(saved.id)).toBeUndefined();

    const other = store.upsertUserRecipe("del_user2", makeRecord("usr_del_2", "导出验证菜", ["番茄", "鸡蛋"]));
    expect(privacy.getUserDataOverview("del_user2").database.userRecipes).toBe(1);
    const exportPath = privacy.exportUserData("del_user2", []);
    const { readFile } = await import("node:fs/promises");
    const exported = JSON.parse(await readFile(exportPath, "utf8")) as Record<string, any>;
    expect(exported.database.userRecipes.some((r: { id: string }) => r.id === other.id)).toBe(true);
    privacy.deleteUserData("del_user2", () => {});
    expect(privacy.getUserDataOverview("del_user2").database.userRecipes).toBe(0);
  });

  it("v23 迁移已建 user_recipes 表", () => {
    const row = store.getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_recipes'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("user_recipes");
  });
});
