/**
 * HowToCook 导入管道 runner。
 *
 * 用法：npm run import:htc -- --stage parse
 * P1 阶段只做解析与漏斗报告，不入库：
 * - 源码按固定 commit + sha256 拉取并缓存到 data/howtocook-src/（gitignore）
 * - 解析六类（aquatic/breakfast/meat_dish/soup/staple/vegetable_dish）全部 md
 * - 报告写入 data/import/htc-p1-report.json，console 输出摘要
 * 严格参数校验：未知参数直接报错。
 */
import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HTC_CATEGORIES, type HtcCategory, type HtcParseResult, type HtcSourceRef } from "../src/import/howtocook/types.js";
import { HTC_COMMIT, HTC_REPO, HTC_TARBALL_SHA256, ensureHtcSourceAvailable } from "../src/import/howtocook/fetchSource.js";
import { parseHtcMarkdown } from "../src/import/howtocook/parseMarkdown.js";
import { buildFunnelReport } from "../src/import/howtocook/funnel.js";

{
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length !== 2 || rawArgs[0] !== "--stage" || rawArgs[1] !== "parse") {
    throw new Error(`用法：npm run import:htc -- --stage parse（当前仅支持 parse 阶段，收到：${rawArgs.join(" ")}）`);
  }
}

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

const report = buildFunnelReport(results, { repo: HTC_REPO, commit: HTC_COMMIT, tarballSha256: HTC_TARBALL_SHA256 });
const outputDir = join(projectRoot, "data", "import");
mkdirSync(outputDir, { recursive: true });
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
