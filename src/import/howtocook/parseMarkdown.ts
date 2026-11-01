/**
 * HowToCook markdown 解析（纯函数，不碰文件系统）。
 *
 * 已实测的格式要点（commit 308cc8b）：
 * - 标题 `# 菜名的做法`（剥"的做法"）；难度行 `预估烹饪难度：★★★★`；
 *   `预估卡路里：…` 按营养数据规则直接丢弃。
 * - `## 必备原料和工具`：`- ` 与 `* ` 列表混用，内嵌 `### 可选原料` 子段；
 *   食材与工具混排（厨具由 separateUtensils 分离），项内常见括号注释。
 * - `## 操作`：`### ` 子节有两种用法——互斥**版本**（简易版本/进阶版本，
 *   下班做饭场景取"简易/快手/懒人"优先，其余版本不建记录避免同名多记
 *   录给去重添乱）与顺序**阶段分组**（备菜/腌制/蒸制，步骤必须全保留，
 *   阶段标题以【阶段】行插入）。判别：任一子标题含"版本"或命中简易
 *   词表才按版本处理，否则按阶段分组。
 * - 步骤为有序列表，解析时剥序号；分钟数（含"小时"）正则求和，供 P3
 *   交叉检查 totalMinutes 用。
 */
import type { HtcCategory, HtcParseResult, HtcRawRecipe, HtcSourceRef } from "./types.js";
import { separateUtensils } from "./separateUtensils.js";

const PREFERRED_VARIANTS = ["简易", "快手", "懒人", "简单", "基础"];

export function parseHtcMarkdown(
  markdown: string,
  category: HtcCategory,
  source: HtcSourceRef,
): HtcParseResult {
  const problems: string[] = [];
  const lines = markdown.split(/\r?\n/);

  // 菜名：首个一级标题，剥"的做法"等尾缀
  const titleLine = lines.find((line) => line.startsWith("# "));
  let name = "";
  if (titleLine) {
    name = titleLine.slice(2).trim().replace(/(?:的做法|做法)$/, "");
  } else {
    problems.push("缺少一级标题（菜名）");
  }

  // 难度星级
  const difficultyMatch = markdown.match(/预估烹饪难度：\s*(★+)/);
  const difficulty = difficultyMatch ? difficultyMatch[1]!.length : 0;
  if (!difficultyMatch) problems.push("缺少难度星级");

  // 按 ## 切段（保留 ### 归属在其 ## 之下）
  const sections = splitH2Sections(lines);
  const requiredSection = sections.find((section) => section.title.includes("必备原料"));
  const computeSection = sections.find((section) => section.title === "计算");
  const operationSection = sections.find((section) => section.title.includes("操作"));

  // "### 可选原料"是必备段内部的子标题，不占独立 ## 段——在段内切分
  const splitRequired = requiredSection
    ? splitOptionalSubsection(requiredSection.bodyLines)
    : { requiredLines: [] as string[], optionalLines: [] as string[] };
  const rawRequired = listItems(splitRequired.requiredLines);
  if (!requiredSection) problems.push("缺少「必备原料和工具」段");
  else if (rawRequired.length === 0) problems.push("「必备原料和工具」段没有列表项");

  const rawOptional = listItems(splitRequired.optionalLines);

  const separation = separateUtensils([...rawRequired, ...rawOptional]);
  const requiredFoods = separation.foods.slice(0, rawRequired.length);
  const optionalFoods = separation.foods.slice(rawRequired.length);

  // 操作段：### 子节可能是互斥版本（简易版本/进阶版本/xxx fork 版本）、
  // 顺序阶段分组（备菜/腌制/煎制）或两者混合（青椒酿 = 5 阶段 + 1 fork 版本）。
  // 处理：非版本子节归并为"默认流程"（阶段标题以【阶段】行保留）；存在版本
  // 子节时在版本间选择——简易/快手/懒人优先，其次默认流程，最后第一个版本。
  let steps: string[] = [];
  let chosenVariant: string | undefined;
  let variantCount = 1;
  if (!operationSection) {
    problems.push("缺少「操作」段");
  } else {
    const subSections = splitVariants(operationSection.bodyLines);
    const isVersionTitle = (title: string) =>
      title.includes("版本") || PREFERRED_VARIANTS.some((word) => title.includes(word));
    const versionSections = subSections.filter((section) => isVersionTitle(section.title));
    const flowSections = subSections.filter((section) => !isVersionTitle(section.title));
    const flattenFlow = () => flowSections.flatMap((section) =>
      flowSections.length === 1 && section.title === "默认"
        ? section.lines
        : [`【阶段】${section.title}`, ...section.lines],
    ).filter((line) => line.trim().length > 0);

    if (versionSections.length > 0) {
      const hasFlow = flowSections.some((section) => section.lines.some((line) => line.trim().length > 0));
      variantCount = versionSections.length + (hasFlow ? 1 : 0);
      const preferred = versionSections.find((section) =>
        PREFERRED_VARIANTS.some((word) => section.title.includes(word)));
      const chosen = preferred
        ?? (hasFlow ? { title: "默认做法", lines: flattenFlow() } : versionSections[0]!);
      chosenVariant = variantCount > 1 ? chosen.title : undefined;
      steps = chosen.lines.filter((line) => line.trim().length > 0);
    } else {
      steps = flattenFlow();
    }
    if (steps.length === 0) problems.push("操作段没有步骤");
  }

  if (problems.length > 0 || !name) {
    return { recipe: undefined, problems };
  }

  return {
    recipe: {
      name,
      category,
      difficulty,
      requiredItems: requiredFoods,
      optionalItems: optionalFoods,
      utensils: separation.utensils,
      computeLines: computeSection ? computeSection.bodyLines.filter((line) => line.trim().length > 0) : [],
      steps,
      chosenVariant,
      variantCount,
      stepMinutesTotal: sumStepMinutes(steps.join("\n")),
      source,
    },
    problems,
  };
}

interface H2Section {
  title: string;
  bodyLines: string[];
}

/** 必备段内切出"### 可选原料"子段：返回可选标题前/后的行。 */
function splitOptionalSubsection(bodyLines: readonly string[]): { requiredLines: string[]; optionalLines: string[] } {
  const index = bodyLines.findIndex((line) => line.startsWith("### ") && line.includes("可选原料"));
  if (index === -1) return { requiredLines: [...bodyLines], optionalLines: [] };
  return {
    requiredLines: bodyLines.slice(0, index),
    optionalLines: bodyLines.slice(index + 1),
  };
}

function splitH2Sections(lines: readonly string[]): H2Section[] {
  const sections: H2Section[] = [];
  let current: H2Section | undefined;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = { title: line.slice(3).trim(), bodyLines: [] };
      sections.push(current);
    } else if (line.startsWith("# ")) {
      current = undefined; // 一级标题之前的内容（简介/难度/卡路里行）不进任何段
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  return sections;
}

/** 列表项：`- xxx`、`* xxx` 与 `+ xxx`（实测三种标记都存在），剥标记与首尾空白。 */
function listItems(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.match(/^\s*(?:[-*+])\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

interface OperationVariant {
  title: string;
  lines: string[];
}

function splitVariants(lines: readonly string[]): OperationVariant[] {
  const variants: OperationVariant[] = [];
  let current: OperationVariant = { title: "默认", lines: [] };
  let sawSubHeading = false;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (sawSubHeading || current.lines.length > 0) variants.push(current);
      current = { title: line.slice(4).trim(), lines: [] };
      sawSubHeading = true;
    } else {
      current.lines.push(line.replace(/^\s*\d+[.、)]\s*/, "")); // 剥有序列表序号
    }
  }
  variants.push(current);
  return variants.filter((variant) => variant.lines.some((line) => line.trim().length > 0) || variants.length === 1);
}

/** 步骤文本里的分钟数合计："腌制 1 小时" 计 60，"焖 2 分钟" 计 2。 */
export function sumStepMinutes(text: string): number | undefined {
  let total = 0;
  let matched = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(分钟|小时)/g)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    total += match[2] === "小时" ? value * 60 : value;
    matched = true;
  }
  return matched ? Math.round(total) : undefined;
}
