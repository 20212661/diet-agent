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
import { INGREDIENT_DEFINITIONS } from "../src/recipes/ingredientTaxonomy.js";

const STAGES = ["parse", "propose", "apply-rules"] as const;
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
} else {
  throw new Error("unreachable");
}

