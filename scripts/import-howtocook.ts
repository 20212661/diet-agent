/**
 * HowToCook 导入管道 runner。
 *
 * 用法：
 *   npm run import:htc -- --stage parse     # P1：解析与漏斗报告
 *   npm run import:htc -- --stage propose   # P2：LLM 同义聚类 + 过敏原提议（产出人工审核文件）
 * 严格参数校验：未知参数直接报错。源码按固定 commit + sha256 拉取并缓存。
 */
import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HTC_CATEGORIES, type HtcCategory, type HtcParseResult, type HtcRawRecipe, type HtcSourceRef } from "../src/import/howtocook/types.js";
import { HTC_COMMIT, HTC_REPO, HTC_TARBALL_SHA256, ensureHtcSourceAvailable } from "../src/import/howtocook/fetchSource.js";
import { parseHtcMarkdown } from "../src/import/howtocook/parseMarkdown.js";
import { buildFunnelReport } from "../src/import/howtocook/funnel.js";
import { collectUnmapped, clusterPropose } from "../src/import/howtocook/clusterPropose.js";
import { applyRules } from "../src/import/howtocook/applyRules.js";
import { generateTaxonomySource } from "../src/import/howtocook/writeTaxonomy.js";
import { completeFields, crossCheck, type CompletedFields } from "../src/import/howtocook/completeFields.js";
import { dedupeCheck, htcRecipeId } from "../src/import/howtocook/dedupe.js";
import { deriveRecipeIngredientMetadata } from "../src/recipes/ingredientTaxonomy.js";
import { INGREDIENT_DEFINITIONS } from "../src/recipes/ingredientTaxonomy.js";

const STAGES = ["parse", "propose", "apply-rules", "write-taxonomy", "complete", "select"] as const;
const rawArgs = process.argv.slice(2);
const stageArg = rawArgs.length === 2 && rawArgs[0] === "--stage" ? rawArgs[1] : undefined;
if (!stageArg || !STAGES.includes(stageArg as (typeof STAGES)[number])) {
  throw new Error(`用法：npm run import:htc -- --stage ${STAGES.join("|")}（收到：${rawArgs.join(" ")}）`);
}
const runStage: (typeof STAGES)[number] = stageArg as (typeof STAGES)[number];

const projectRoot = process.cwd();
const sourceDir = ensureHtcSourceAvailable(join(projectRoot, "data", "howtocook-src"));

function listMarkdownFiles(category: HtcCategory): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  };
  walk(join(sourceDir, "dishes", category));
  return files.sort();
}

function parseAll(): Array<{ path: string; result: HtcParseResult }> {
  const results: Array<{ path: string; result: HtcParseResult }> = [];
  for (const category of HTC_CATEGORIES) {
    for (const file of listMarkdownFiles(category)) {
      const relativePath = file.slice(sourceDir.length + 1).replaceAll("\\", "/");
      const source: HtcSourceRef = { repo: HTC_REPO, commit: HTC_COMMIT, path: relativePath };
      try {
        results.push({ path: relativePath, result: parseHtcMarkdown(readFileSync(file, "utf8"), category, source) });
      } catch (error) {
        results.push({
          path: relativePath,
          result: { recipe: undefined, problems: [`读取/解析异常：${error instanceof Error ? error.message : String(error)}`] },
        });
      }
    }
  }
  return results;
}

const outputDir = join(projectRoot, "data", "import");
mkdirSync(outputDir, { recursive: true });

if (runStage === "parse") {
  const report = buildFunnelReport(parseAll(), { repo: HTC_REPO, commit: HTC_COMMIT, tarballSha256: HTC_TARBALL_SHA256 });
  const reportFile = join(outputDir, "htc-p1-report.json");
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log(`📊 HowToCook P1 漏斗（commit ${HTC_COMMIT.slice(0, 7)}，sha256 校验通过）`);
  console.log(`  解析 ${report.totals.parsed}/${report.totals.files} 道（失败 ${report.totals.failed}）`);
  console.log(`  多版本 ${report.totals.multiVersion} 道；无计算段 ${report.totals.withoutCompute}；步骤无分钟数 ${report.totals.withoutStepMinutes}`);
  console.log(`  厨具分离 ${report.utensils.separatedCount} 项（漏网抽样 ${report.utensils.missedSamples.length} 种）`);
  console.log(`  分类表覆盖率：按出现次数 ${pct(report.coverage.coverageByOccurrence)}（${report.coverage.mappedOccurrences}/${report.coverage.ingredientOccurrences}）；按写法种类 ${pct(report.coverage.coverageByVariant)}（${report.coverage.mappedDistinctNames}/${report.coverage.distinctNames}）`);
  const suspects = report.topUnmapped.filter((item) => item.suspectAllergen);
  console.log(`  未映射 Top50 中疑似过敏原 ${suspects.length} 项：${suspects.slice(0, 12).map((item) => item.name).join("、")}${suspects.length > 12 ? " …" : ""}`);
  console.log(`报告已写入 ${reportFile}`);
} else if (runStage === "propose") {
  // P2 propose：聚类提议（LLM），产出人工审核文件——过敏原以人工批注为准
  const recipes = parseAll()
    .map((entry) => entry.result.recipe)
    .filter((recipe): recipe is HtcRawRecipe => recipe !== undefined);
  const unmapped = collectUnmapped(recipes);
  console.log(`📥 解析 ${recipes.length} 道；未映射写法 ${unmapped.size} 种`);

  const taxonomySummary = INGREDIENT_DEFINITIONS
    .map((definition) => `${definition.id}: ${definition.aliases.slice(0, 6).join("/")}${definition.allergens ? `（过敏原 ${definition.allergens.join("/")}）` : ""}`)
    .join("\n");
  const proposals = await clusterPropose(unmapped, taxonomySummary);

  const review = proposals.filter((proposal) => proposal.channel === "review");
  const batch = proposals.filter((proposal) => proposal.channel === "batch");
  const output = {
    generatedAt: new Date().toISOString(),
    source: { repo: HTC_REPO, commit: HTC_COMMIT },
    notes: [
      "审核规则：review 组逐条判定（含 LLM 说不含过敏原但命中疑似词表的项）；",
      "batch 组为无过敏原提议且不命中词表，可批量通过后随机抽 10% 复核。",
      "每项填 approved: true/false；allergensFinal 为你最终裁定的过敏原（可改 LLM 提议）。",
      "批准后由下一阶段脚本写入分类表并重算（v22 迁移）。",
    ],
    counts: {
      distinctWritingForms: unmapped.size,
      canonicalGroups: proposals.length,
      reviewChannel: review.length,
      batchChannel: batch.length,
      occurrencesTotal: proposals.reduce((sum, proposal) => sum + proposal.occurrences, 0),
    },
    proposals: proposals.map((proposal) => ({ ...proposal, approved: undefined, allergensFinal: undefined })),
  };
  const proposalFile = join(outputDir, "htc-taxonomy-proposals.json");
  writeFileSync(proposalFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`🧩 聚类：${unmapped.size} 种写法 → ${proposals.length} 个规范名组（review ${review.length} / batch ${batch.length}）`);
  console.log(`  review 组 Top：${review.slice(0, 10).map((proposal) => `${proposal.canonical}(${proposal.occurrences})`).join("、")}`);
  console.log(`审核文件已写入 ${proposalFile}`);
} else if (runStage === "apply-rules") {
  // P2 规则执行：读提议 → 应用人工规则表 → 导出最终判定（人工扫表通过后才写分类表）
  const proposals = JSON.parse(readFileSync(join(outputDir, "htc-taxonomy-proposals.json"), "utf8")).proposals;
  const { applied, readmeTodos } = applyRules(proposals);
  writeFileSync(join(outputDir, "htc-applied-rules.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), readmeTodos, applied }, null, 2)}\n`, "utf8");

  const byBasis = new Map<string, { count: number; occurrences: number }>();
  for (const item of applied) {
    const entry = byBasis.get(item.basis) ?? { count: 0, occurrences: 0 };
    entry.count += 1;
    entry.occurrences += item.occurrences;
    byBasis.set(item.basis, entry);
  }
  console.log("📋 规则执行：" + applied.length + " 组（分裂组已归并）");
  for (const [basis, entry] of [...byBasis.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)) {
    console.log("  " + basis + "：" + entry.count + " 组 / " + entry.occurrences + " 次");
  }
  const withPossible = applied.filter((item) => item.possibleAllergens.length > 0);
  console.log("  含 possibleAllergens 的组：" + withPossible.length + "（Top：" + withPossible.slice(0, 8).map((item) => item.canonical + "[" + item.possibleAllergens.join("/") + "]").join("、") + "）");
  console.log("结果已写入 data/import/htc-applied-rules.json");
} else if (runStage === "write-taxonomy") {
  // P2-3：把扫表定案的判定写成数据文件（人工补丁内置于生成器）
  const applied = JSON.parse(readFileSync(join(outputDir, "htc-applied-rules.json"), "utf8")).applied;
  const generated = generateTaxonomySource(applied);
  const fileContent = `// 自动生成：npm run import:htc -- --stage write-taxonomy（判定=人工规则表+扫表定案 2026-11-02）。请勿手改，重跑生成器覆写。
// 数据来源 HowToCook（Unlicense）commit ${HTC_COMMIT.slice(0, 7)} 的食材聚类；人工补丁见 src/import/howtocook/writeTaxonomy.ts。
import type { AllergenId } from "../types/diet.js";

export const HTC_INGREDIENT_DEFINITIONS: ReadonlyArray<{
  id: string; aliases: string[]; allergens: AllergenId[]; possibleAllergens: AllergenId[];
}> = ${JSON.stringify(generated.definitions, null, 2)};

export const HTC_ALIAS_EXTENSIONS: Readonly<Record<string, string[]>> = ${JSON.stringify(generated.aliasExtensions, null, 2)};
`;
  const target = join(projectRoot, "src", "recipes", "ingredientTaxonomyHowToCook.ts");
  const { writeFileSync: writeFile } = await import("node:fs");
  writeFile(target, fileContent, "utf8");
  console.log(`📝 分类表生成：新建 ${generated.stats.newEntries} 条目 / 挂靠扩别名 ${generated.stats.aliasExtensions} 个 / 人工补丁 ${generated.stats.patched} 项 / 跳过 ${generated.stats.skipped} 组`);
  console.log(`已写入 ${target}`);
  console.log("后续：npm run recipes:enrich && npm run validate:recipes");
} else if (runStage === "complete") {
  // P3：LLM 补全结构字段 + 校验 + 去重 → 候选与审阅报告（不入库）
  const seedRecipes = JSON.parse(readFileSync(join(projectRoot, "src", "recipes", "recipeSeed.json"), "utf8"));
  const recipes = parseAll().map((entry) => entry.result.recipe).filter((recipe): recipe is HtcRawRecipe => recipe !== undefined);
  console.log(`📥 补全 ${recipes.length} 道（批量 5 道/请求）…`);
  const completions = await completeFields(recipes);

  const timingMismatches: Array<{ name: string; totalMinutes: number; stepMinutes: number; source: string }> = [];
  const candidates: unknown[] = [];
  const flagged: Array<{ id: string; name: string; flags: string[] }> = [];
  const pendingQueue: Array<{ name: string; source: string; problems: string[] }> = [];
  const acceptedSoFar: Array<{ name: string; ingredients: string[] }> = [];

  for (const { recipe, fields, problems, retried } of completions) {
    if (!fields) {
      const allProblems = [...problems, ...(retried ? ["已重试"] : [])];
      pendingQueue.push({ name: recipe.name, source: recipe.source.path, problems: allProblems });
      // 耗时不一致的菜因校验失败进待处理队列——统计必须包含它们（幸存者偏差修正）
      const timingProblem = problems.find((problem) => problem.includes("与步骤分钟合计") && problem.includes("不一致"));
      if (timingProblem && recipe.stepMinutesTotal !== undefined) {
        const total = Number(timingProblem.match(/totalMinutes=(\d+)/)?.[1] ?? 0);
        timingMismatches.push({ name: recipe.name, totalMinutes: total, stepMinutes: recipe.stepMinutesTotal, source: recipe.source.path });
      }
      continue;
    }
    // 耗时一致性统计（用户要求单独口径：totalMinutes 与步骤分钟合计差超出 [-20,+45]）
    if (recipe.stepMinutesTotal !== undefined) {
      const delta = fields.totalMinutes - recipe.stepMinutesTotal;
      if (delta < -20 || delta > 45) {
        timingMismatches.push({ name: recipe.name, totalMinutes: fields.totalMinutes, stepMinutes: recipe.stepMinutesTotal, source: recipe.source.path });
      }
    }
    const dedupe = dedupeCheck(recipe, [...seedRecipes, ...acceptedSoFar.map((a) => ({ name: a.name, ingredients: a.ingredients, optionalIngredients: [], vegetables: [], staples: [] }))]);
    const flags: string[] = [];
    if (dedupe.nameDuplicateOf) flags.push(`与种子/已收菜同名：${dedupe.nameDuplicateOf}（变体保留）`);
    if (dedupe.suspectedDuplicates.length > 0) flags.push(`疑似重复（Jaccard≥0.7）：${dedupe.suspectedDuplicates.join("、")}`);
    if (recipe.utensils.some((u) => /锅|碗|盆/.test(u)) && fields.cookware.length === 0) flags.push("解析出厨具但 LLM 未填 cookware");

    const id = htcRecipeId(recipe.source.path);
    const ingredientIds = deriveRecipeIngredientMetadata([...recipe.requiredItems, ...recipe.optionalItems]);
    candidates.push({
      id,
      name: recipe.name,
      mode: fields.mode,
      modes: fields.modes,
      mealTypes: fields.mealTypes,
      suitableGoals: fields.suitableGoals,
      ingredients: recipe.requiredItems,
      optionalIngredients: recipe.optionalItems,
      ingredientIds: ingredientIds.ingredientIds,
      allergenTags: ingredientIds.allergenTags,
      primaryProtein: fields.primaryProtein,
      vegetables: fields.vegetables,
      staples: fields.staples,
      cookware: fields.cookware,
      appliances: fields.appliances,
      activeMinutes: fields.activeMinutes,
      totalMinutes: fields.totalMinutes,
      difficulty: recipe.difficulty,
      dishCount: fields.dishCount,
      tasteTags: fields.tasteTags,
      preferenceTags: fields.preferenceTags,
      steps: recipe.steps,
      timeline: fields.timeline,
      lowEnergySwap: fields.lowEnergySwap,
      source: recipe.source,
      computeLines: recipe.computeLines,
      dedupeFlags: flags,
    });
    if (flags.length > 0) flagged.push({ id, name: recipe.name, flags });
    acceptedSoFar.push({ name: recipe.name, ingredients: [...recipe.requiredItems, ...recipe.optionalItems] });
  }

  const timingDenominator = completions.filter((c) => c.fields).length + timingMismatches.filter((m) => !completions.find((c) => c.recipe.name === m.name && c.fields)).length;
  const mismatchRatio = timingDenominator > 0
    ? Math.round((1000 * timingMismatches.length) / timingDenominator) / 1000
    : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      input: recipes.length,
      completed: candidates.length,
      pending: pendingQueue.length,
      flagged: flagged.length,
      nameDuplicates: flagged.filter((f) => f.flags.some((x) => x.includes("同名"))).length,
      suspectedDuplicates: flagged.filter((f) => f.flags.some((x) => x.includes("疑似"))).length,
      timingMismatchCount: timingMismatches.length,
      timingMismatchRatio: mismatchRatio,
    },
    timingMismatches,
    timingMismatchExamples: timingMismatches.slice(0, 5),
    pendingQueue,
    flagged,
    candidates,
  };
  writeFileSync(join(outputDir, "htc-p3-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`✅ 补全 ${candidates.length}/${recipes.length}（待处理 ${pendingQueue.length}，重试后仍败 ${pendingQueue.filter((p) => p.problems.some((x) => x.includes("重试"))).length}）`);
  console.log(`  标记：同名 ${report.totals.nameDuplicates} / 疑似重复 ${report.totals.suspectedDuplicates}（可重叠）`);
  console.log(`  ⏱ 耗时不一致：${timingMismatches.length} 道（${(mismatchRatio * 100).toFixed(1)}%），前 5 例：${timingMismatches.slice(0, 5).map((m) => `${m.name}(LLM ${m.totalMinutes} vs 步骤 ${m.stepMinutes})`).join("、")}`);
  console.log(`报告与候选已写入 data/import/htc-p3-report.json`);
} else if (runStage === "select") {
  // P4 首批选择：从候选按定案标准选 100-150 道，排除同名/疑似/耗时候选；
  // 导出名单+审阅卡片（随机 20 道全字段 + 标记条目 + activeMinutes 抽查 15 道）
  const report = JSON.parse(readFileSync(join(outputDir, "htc-p3-report.json"), "utf8"));
  const candidates: Array<Record<string, unknown>> = report.candidates;
  const excluded = { name: 0, suspected: 0, unmapped: 0 };
  const TEMPLATE_MARKERS = ["桥接模式", "抽象层", "实现层", "extends", "implements", "万物皆可酿"];
  const eligible = candidates.filter((c) => {
    const flags = (c.dedupeFlags as string[]) ?? [];
    if (flags.some((f) => f.includes("同名"))) { excluded.name += 1; return false; }
    if (flags.some((f) => f.includes("疑似"))) { excluded.suspected += 1; return false; }
    return true;
  }).filter((c) => {
    // 模板/元菜谱（如"桂林十八酿"讲的是桥接模式方法论，不是具体菜）
    if ((c.steps as string[]).some((step) => TEMPLATE_MARKERS.some((marker) => step.includes(marker)))) { excluded.unmapped += 0; (excluded as Record<string, number>).template = ((excluded as Record<string, number>).template ?? 0) + 1; return false; }
    return true;
  }).filter((c) => {
    const unmapped = (c.ingredientIds as string[]).some((id) => id.startsWith("ingredient:"));
    if (unmapped) { excluded.unmapped += 1; return false; }
    return true;
  });

  // 隐藏过敏原优先（allergenTags 非空或食材命中 possible 条目——用候选的 allergenTags 非空近似 + 食材名单含加工品）
  const HIDDEN_HINTS = ["蚝油", "料酒", "豆豉", "鸡精", "味精", "芝士", "蛋黄酱", "沙拉酱", "十三香", "五香粉", "火腿", "午餐肉", "腊肠", "培根", "方便面", "啤酒", "醋"];
  const hiddenAllergen = (c: Record<string, unknown>) => {
    const ings = [...(c.ingredients as string[]), ...(c.optionalIngredients as string[])];
    return HIDDEN_HINTS.some((hint) => ings.some((i) => i.includes(hint)));
  };
  // 难度≤3 与主动≤40 为优先档，超出的进次级档截断用
  const quota: Record<string, number> = { aquatic: 11, breakfast: 10, meat_dish: 43, soup: 9, staple: 23, vegetable_dish: 25 };
  const picked: Array<Record<string, unknown>> = [];
  for (const [category, limit] of Object.entries(quota)) {
    const pool = eligible.filter((c) => (c.source as Record<string, string>).path.includes(`dishes/${category}/`));
    const primary = pool.filter((c) => (c.difficulty as number) <= 3 && (c.activeMinutes as number) <= 40);
    const secondary = pool.filter((c) => !primary.includes(c));
    primary.sort((a, b) => Number(hiddenAllergen(b)) - Number(hiddenAllergen(a)));
    secondary.sort((a, b) => Number(hiddenAllergen(b)) - Number(hiddenAllergen(a)));
    picked.push(...primary.slice(0, limit), ...secondary.slice(0, Math.max(0, limit - primary.length)));
  }

  const byCategory = picked.reduce((acc: Record<string, number>, c) => {
    const cat = (c.source as Record<string, string>).path.match(/dishes\/([a-z_]+)\//)?.[1] ?? "?";
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});
  const hiddenCount = picked.filter(hiddenAllergen).length;
  const activeValues = picked.map((c) => c.activeMinutes as number);

  writeFileSync(join(outputDir, "htc-p4-selection.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), total: picked.length, byCategory, hiddenAllergenCount: hiddenCount, excluded, picked }, null, 2)}\n`, "utf8");

  // 审阅卡片：随机 20 道全字段 + activeMinutes 抽查 15 道（步骤全文+LLM 值）
  const shuffled = [...picked].sort(() => Math.random() - 0.5);
  const cardRecipes = shuffled.slice(0, 20);
  const timingSample = shuffled.slice(20, 35);
  const card = (c: Record<string, unknown>) => [
    `### ${c.name}（${(c.source as Record<string, string>).path}）`,
    `- 分类 ${c.mode}/${(c.mealTypes as string[]).join("+")}｜难度 ${c.difficulty}★｜主动 ${c.activeMinutes}min / 总 ${c.totalMinutes}min｜${c.dishCount} 盘｜器具 ${(c.appliances as string[]).join("+") || "-"} ${(c.cookware as string[]).join("/")}`,
    `- 食材：${(c.ingredients as string[]).join("、")}${(c.optionalIngredients as string[]).length ? `（可选：${(c.optionalIngredients as string[]).join("、")}）` : ""}`,
    `- 过敏原标签：${(c.allergenTags as string[]).join(",") || "无"}`,
    `- 口味：${(c.tasteTags as string[]).join("/") || "-"}｜蛋白 ${c.primaryProtein ?? "-"}｜主食 ${(c.staples as string[]).join("/") || "-"}`,
    `- 步骤：\n${(c.steps as string[]).map((s) => `  ${s}`).join("\n")}`,
  ].join("\n");
  const timingCard = (c: Record<string, unknown>) => `### ${c.name}｜LLM 主动 ${c.activeMinutes}min / 总 ${c.totalMinutes}min（步骤分钟合计 ${(c as Record<string, unknown>).stepMinutesTotal ?? "未提取"}）\n${(c.steps as string[]).map((s) => `  ${s}`).join("\n")}`;
  const review = [
    `# P4 首批审阅卡片（${picked.length} 道，排除同名 ${excluded.name}/疑似 ${excluded.suspected}/含未映射食材 ${excluded.unmapped}）`,
    ``,
    `分类分布：${JSON.stringify(byCategory)}；隐藏过敏原菜 ${hiddenCount} 道；主动分钟 avg ${Math.round(activeValues.reduce((a, b) => a + b, 0) / activeValues.length)}。`,
    ``,
    `## 一、随机 20 道全字段卡片`,
    ...cardRecipes.map(card),
    ``,
    `## 二、activeMinutes 抽查 15 道（重点字段，请人工估算动手时间与 LLM 值比对）`,
    ...timingSample.map(timingCard),
  ].join("\n");
  writeFileSync(join(outputDir, "htc-p4-review.md"), review, "utf8");
  console.log(`📋 首批选择：${picked.length} 道（排除同名 ${excluded.name} / 疑似 ${excluded.suspected} / 未映射 ${excluded.unmapped}）`);
  console.log(`  分类：${JSON.stringify(byCategory)}；隐藏过敏原 ${hiddenCount} 道`);
  console.log(`审阅卡片：data/import/htc-p4-review.md（随机 20 全字段 + activeMinutes 抽查 15）`);
} else {
  throw new Error("unreachable");
}

