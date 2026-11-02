import { describe, expect, it } from "vitest";
import { parseHtcMarkdown, sumStepMinutes } from "../import/howtocook/parseMarkdown.js";
import { separateUtensils } from "../import/howtocook/separateUtensils.js";
import { normalizeIngredientText } from "../import/howtocook/normalize.js";
import { buildFunnelReport } from "../import/howtocook/funnel.js";
import { sha256Of } from "../import/howtocook/fetchSource.js";
import { applyRules, mergeSplitGroups } from "../import/howtocook/applyRules.js";
import type { TaxonomyProposal } from "../import/howtocook/clusterPropose.js";
import type { HtcParseResult, HtcSourceRef } from "../import/howtocook/types.js";

const source: HtcSourceRef = {
  repo: "Anduin2017/HowToCook",
  commit: "308cc8b7dab1da84b20e7fafdf836a715437f582",
  path: "dishes/test/test.md",
};

function parse(markdown: string, category: Parameters<typeof parseHtcMarkdown>[1] = "meat_dish"): HtcParseResult {
  return parseHtcMarkdown(markdown, category, source);
}

// ---- 真实样本（节选自 commit 308cc8b 源文件，保留原始行文） ----

/** dishes/meat_dish/宫保鸡丁/宫保鸡丁.md：多版本 + 可选原料 + 括号注释 */
const GONGBAO = `# 宫保鸡丁的做法

预估烹饪难度：★★★★

预估卡路里：1790 大卡

## 必备原料和工具

- 手枪腿（或者鸡胸脯肉）
- 大葱
- 干辣椒（或者二荆条）
- 料酒
- 芝麻油

### 可选原料

- 油泼辣子
- 莴笋
- 豆瓣酱

## 计算

每份手枪腿 350g。

## 操作

### 简易版本

1. 鸡腿肉切 1.5cm 见方的丁，清水浸泡 10 分钟。
2. 腌制 1 小时。
3. 倒入料酒与酱油，炒匀后加盖焖 2 分钟。

### 稍加复杂但是更加令人垂涎欲滴的版本

1. 莴笋切丁备用。
2. 复杂流程第一步。

## 附加内容

- 一些说明
`;

/** dishes/staple/蛋炒饭.md：* 列表、单版本无 ### 子节 */
const FRIED_RICE = `# 蛋炒饭的做法

预估烹饪难度：★★★

预估卡路里：853 大卡

## 必备原料和工具

* 冷饭
* 鸡蛋
* 火腿
* 油
* 盐
* 胡椒粉

## 计算

每份冷饭 300g。

## 操作

1. 鸡蛋打散，加一点盐。
2. 热锅倒油，大火炒蛋 1 分钟。
3. 倒入冷饭，翻炒 3 分钟。
`;

/** dishes/breakfast/太阳蛋/太阳蛋.md：工具混排在原料里 */
const SUNNY_EGG = `# 太阳蛋的做法

预估烹饪难度：★★

## 必备原料和工具

- 鸡蛋
- 盐
- 油
- 分可控火候微波炉或不可控火候微波炉（定义和分辨方式请见附加内容）

## 计算

每份鸡蛋 1 个。

## 操作

1. 碗里抹油，打入鸡蛋，牙签戳几下蛋黄。
2. 可控火候微波炉 3 分钟。
`;

/** dishes/meat_dish/农家一碗香/农家一碗香.md：+ 列表（首跑唯一失败样本） */
const NONGJIA = `# 农家一碗香的做法

预估烹饪难度：★★★

## 必备原料和工具

+ 猪肉（推荐五花肉）
+ 青椒
+ 蒜片
+ 豆瓣酱

## 计算

每份猪肉 150g。

## 操作

1. 五花肉切片，中火煸炒 5 分钟。
`;

/** dishes/vegetable_dish/青椒酿/青椒酿.md：阶段分组 + fork 版本混合结构 */
const QINGJIAO_NIANG = `# 青椒酿的做法

预估烹饪难度：★★★

## 必备原料和工具

- 青椒
- 猪肉末
- 淀粉

## 计算

每份青椒 6 根。

## 操作

### 准备馅料

1. 猪肉末加调料，搅打上劲，腌制 15 分钟。

### 处理青椒

2. 青椒对半切开去籽。

### 酿入肉馅

3. 把馅料酿入青椒。

### 煎制焖煮

4. 少油煎 2 分钟后加水焖 5 分钟。

### 虾滑 fork 版本

1. 用虾滑替换猪肉馅。
`;

describe("parseHtcMarkdown（真实样本）", () => {
  it("宫保鸡丁：多版本取简易版本，可选原料独立，括号注释保留原文", () => {
    const { recipe, problems } = parse(GONGBAO);
    expect(problems).toEqual([]);
    expect(recipe!.name).toBe("宫保鸡丁");
    expect(recipe!.difficulty).toBe(4);
    expect(recipe!.requiredItems).toEqual(["手枪腿（或者鸡胸脯肉）", "大葱", "干辣椒（或者二荆条）", "料酒", "芝麻油"]);
    expect(recipe!.optionalItems).toEqual(["油泼辣子", "莴笋", "豆瓣酱"]);
    expect(recipe!.variantCount).toBe(2);
    expect(recipe!.chosenVariant).toBe("简易版本");
    expect(recipe!.steps).toHaveLength(3);
    expect(recipe!.steps[0]).toContain("1.5cm");
    expect(recipe!.computeLines).toEqual(["每份手枪腿 350g。"]);
  });

  it("蛋炒饭：* 列表、单版本、分钟数合计（1+3=4）", () => {
    const { recipe, problems } = parse(FRIED_RICE, "staple");
    expect(problems).toEqual([]);
    expect(recipe!.category).toBe("staple");
    expect(recipe!.requiredItems).toEqual(["冷饭", "鸡蛋", "火腿", "油", "盐", "胡椒粉"]);
    expect(recipe!.variantCount).toBe(1);
    expect(recipe!.chosenVariant).toBeUndefined();
    expect(recipe!.stepMinutesTotal).toBe(4);
  });

  it("太阳蛋：工具（微波炉）从原料分离", () => {
    const { recipe, problems } = parse(SUNNY_EGG, "breakfast");
    expect(problems).toEqual([]);
    expect(recipe!.requiredItems).toEqual(["鸡蛋", "盐", "油"]);
    expect(recipe!.utensils).toEqual(["分可控火候微波炉或不可控火候微波炉（定义和分辨方式请见附加内容）"]);
    expect(recipe!.stepMinutesTotal).toBe(3);
  });

  it("农家一碗香：+ 列表可解析（首跑唯一失败项）", () => {
    const { recipe, problems } = parse(NONGJIA);
    expect(problems).toEqual([]);
    expect(recipe!.requiredItems).toEqual(["猪肉（推荐五花肉）", "青椒", "蒜片", "豆瓣酱"]);
  });

  it("青椒酿：阶段分组+fork 版本混合——选默认流程并全量保留阶段，fork 版本不取", () => {
    const { recipe, problems } = parse(QINGJIAO_NIANG, "vegetable_dish");
    expect(problems).toEqual([]);
    expect(recipe!.variantCount).toBe(2);
    expect(recipe!.chosenVariant).toBe("默认做法");
    expect(recipe!.steps).toEqual([
      "【阶段】准备馅料", "猪肉末加调料，搅打上劲，腌制 15 分钟。",
      "【阶段】处理青椒", "青椒对半切开去籽。",
      "【阶段】酿入肉馅", "把馅料酿入青椒。",
      "【阶段】煎制焖煮", "少油煎 2 分钟后加水焖 5 分钟。",
    ]);
    expect(recipe!.steps.join()).not.toContain("虾滑");
  });

  it("预估卡路里行被丢弃，不出现在任何保留字段", () => {
    const { recipe } = parse(GONGBAO);
    const allText = JSON.stringify(recipe);
    expect(allText).not.toContain("卡路里");
    expect(allText).not.toContain("1790");
  });
});

describe("sumStepMinutes", () => {
  it("小时与分钟混合、多数字累加", () => {
    expect(sumStepMinutes("腌制 1 小时后焖 30 分钟")).toBe(90);
    expect(sumStepMinutes("大火 1.5 分钟")).toBe(2);
    expect(sumStepMinutes("没有时间描述")).toBeUndefined();
  });
});

describe("normalizeIngredientText", () => {
  it("剥括号注释并保留注释供 P2 参考；英文调料折算", () => {
    expect(normalizeIngredientText("干辣椒（或者二荆条）")).toEqual({ normalized: "干辣椒", note: "或者二荆条" });
    expect(normalizeIngredientText("soy sauce")).toEqual({ normalized: "生抽酱油", note: undefined });
  });
});

describe("separateUtensils", () => {
  it("词表命中分离，食材保留", () => {
    const result = separateUtensils(["鸡蛋", "平底锅", "密封袋", "生抽酱油"]);
    expect(result.foods).toEqual(["鸡蛋", "生抽酱油"]);
    expect(result.utensils).toEqual(["平底锅", "密封袋"]);
  });
});

describe("buildFunnelReport 覆盖率口径", () => {
  it("按出现次数与按种类分别计算；未映射项标疑似过敏原", () => {
    // 手写解析结果，不依赖真实分类表的映射状态（分类表扩充后样例写法可能全部映射）
    const handmade = (ingredients: string[], path: string) => ({
      path,
      result: {
        recipe: {
          name: path, category: "meat_dish" as const, difficulty: 1,
          requiredItems: ingredients, optionalItems: [], utensils: [], computeLines: [],
          steps: ["做菜"], chosenVariant: undefined, variantCount: 1, stepMinutesTotal: 1,
          source: { repo: "x", commit: "c", path },
        },
        problems: [],
      },
    });
    const report = buildFunnelReport(
      [handmade(["鸡蛋", "兹拉克斯粒"], "a.md"), handmade(["鸡蛋"], "b.md")],
      { repo: "x", commit: "c", tarballSha256: "s" },
    );
    expect(report.totals.parsed).toBe(2);
    expect(report.coverage).toMatchObject({ ingredientOccurrences: 3, mappedOccurrences: 2 });
    expect(report.coverage.coverageByOccurrence).toBeCloseTo(2 / 3, 2);
    expect(report.coverage.distinctNames).toBe(2);
    expect(report.coverage.coverageByVariant).toBe(0.5);
    expect(report.topUnmapped[0]).toMatchObject({ name: "兹拉克斯粒", count: 1, suspectAllergen: false });
  });
});

describe("sha256Of", () => {
  it("定版 tarball 摘要常量与函数口径一致", () => {
    expect(sha256Of(Buffer.from(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("applyRules（P2 规则执行器）", () => {
  const proposal = (canonical: string, overrides: Partial<TaxonomyProposal> = {}): TaxonomyProposal => ({
    canonical,
    aliases: [canonical],
    existingMatch: undefined,
    suggestedNewId: undefined,
    allergens: [],
    suspectedAllergens: [],
    rationale: "",
    occurrences: 1,
    dishCount: 1,
    sampleDishes: [],
    channel: "review",
    suspectWeak: false,
    ...overrides,
  });

  it("分裂组归并：同名两组合并、频次累加、取更严通道", () => {
    const merged = mergeSplitGroups([
      proposal("料酒", { aliases: ["料酒"], occurrences: 64, channel: "review" }),
      proposal("料酒", { aliases: [" cooking wine"], occurrences: 4, channel: "batch" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.occurrences).toBe(68);
    expect(merged[0]!.channel).toBe("review");
  });

  it("规则表：料酒确定、啤酒 gluten确定+wheat可能、味精/食用油不标、醋按品种", () => {
    const { applied } = applyRules([
      proposal("料酒", { occurrences: 64 }),
      proposal("啤酒", { occurrences: 7 }),
      proposal("味精", { occurrences: 14 }),
      proposal("食用油/植物油", { aliases: ["食用油", "植物油"], occurrences: 99 }),
      proposal("香醋", { occurrences: 8 }),
      proposal("米醋", { occurrences: 5 }),
      proposal("醋", { aliases: ["醋"], occurrences: 18 }),
    ]);
    const by = (name: string) => applied.find((item) => item.canonical === name)!;
    expect(by("料酒")).toMatchObject({ allergens: ["gluten", "wheat"], possibleAllergens: [] });
    expect(by("啤酒")).toMatchObject({ allergens: ["gluten"], possibleAllergens: ["wheat"] });
    expect(by("味精")).toMatchObject({ allergens: [], possibleAllergens: [] });
    expect(by("食用油/植物油")).toMatchObject({ allergens: [], possibleAllergens: [] });
    expect(by("香醋")).toMatchObject({ allergens: ["gluten", "wheat"] });
    expect(by("米醋")).toMatchObject({ allergens: [], possibleAllergens: [] });
    expect(by("醋")).toMatchObject({ allergens: [], possibleAllergens: ["gluten", "wheat"] });
  });

  it("R7 泛化：LLM 仅不确定的意见全部进 possibleAllergens；确定提议照采", () => {
    const { applied } = applyRules([
      proposal("火锅底料", { suspectedAllergens: ["soy", "wheat", "gluten"] }),
      proposal("香油", { allergens: ["sesame"] }),
      proposal("麦冬", { channel: "review" }), // B 组：强词表命中但判无
    ]);
    const by = (name: string) => applied.find((item) => item.canonical === name)!;
    expect(by("火锅底料")).toMatchObject({ allergens: [], possibleAllergens: ["gluten", "soy", "wheat"] });
    expect(by("香油")).toMatchObject({ allergens: ["sesame"] });
    expect(by("麦冬")).toMatchObject({ allergens: [], possibleAllergens: [] });
  });
});
