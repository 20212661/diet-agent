/**
 * 连写食材名拆分（2026-11-07）：按、/，/,拆分、括号内不拆；
 * 用户导入 sanitize 接入；v27 迁移拆分存量。
 */
import { describe, expect, it } from "vitest";
import { splitJoinedIngredients } from "../recipes/ingredientTaxonomy.js";
import { sanitizeExistingDraft } from "../import/userRecipe/extractRecipe.js";

describe("splitJoinedIngredients", () => {
  it("按、/，/,拆分并 trim、丢弃空段", () => {
    expect(splitJoinedIngredients(["酱油，盐，味精", "姜蒜、油", "豆瓣酱,生抽"])).toEqual([
      "酱油", "盐", "味精", "姜蒜", "油", "豆瓣酱", "生抽",
    ]);
    expect(splitJoinedIngredients(["  葱 ", "、", "蒜"])).toEqual(["葱", "蒜"]);
  });

  it("括号内的分隔符不拆（注释枚举是说明不是并列）", () => {
    expect(splitJoinedIngredients(["菜码（黄瓜、白菜、萝卜）"])).toEqual(["菜码（黄瓜、白菜、萝卜）"]);
    expect(splitJoinedIngredients(["鸡精（味精、鸡肉粉）", "盐"])).toEqual(["鸡精（味精、鸡肉粉）", "盐"]);
    expect(splitJoinedIngredients(["火腿肠(或午餐肉，可选)"])).toEqual(["火腿肠(或午餐肉，可选)"]);
  });

  it("无分隔符项原样保留；斜杠不拆（用户指定三种分隔符）", () => {
    expect(splitJoinedIngredients(["肉丁/肉末", "番茄酱/茄汁"])).toEqual(["肉丁/肉末", "番茄酱/茄汁"]);
  });
});

describe("用户导入 sanitize 接入拆分", () => {
  const draft = sanitizeExistingDraft({
    name: "家常小炒",
    ingredients: ["鸡肉、青椒", "蒜，姜", "酱油，盐"],
    steps: ["热油下蒜姜", "下鸡肉青椒", "调味出锅"],
    vegetables: ["土豆、胡萝卜"],
    staples: ["米饭，馒头"],
    optionalIngredients: ["花生碎、芝麻"],
  });
  it("食材四字段在白名单清洗时拆开连写", () => {
    expect(draft.ingredients).toEqual(["鸡肉", "青椒", "蒜", "姜", "酱油", "盐"]);
    expect(draft.vegetables).toEqual(["土豆", "胡萝卜"]);
    expect(draft.staples).toEqual(["米饭", "馒头"]);
    expect(draft.optionalIngredients).toEqual(["花生碎", "芝麻"]);
  });
});
