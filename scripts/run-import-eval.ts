/**
 * P5 用户导入评测 runner：10 份文本跑 LLM 抽取 + 确定性检查器，输出三组指标。
 *
 * 用法：npm run eval:import -- --live（需要 DEEPSEEK_API_KEY；检查器部分确定性可离线，见 vitest）
 *
 * 标注来源：期望食材为 LLM 标注（GLM 起草，待人工扫审）——见 importScenarios.ts 头注。
 *
 * 指标：
 *  - 抽取召回率 / 抽取遗漏率：期望食材（LLM 标注）没被抽到的比例——LLM 抽取责任
 *  - 误抽率：抽取面无法溯源到原文的比例——幻觉责任（预览里用户删/留，不拦截）
 *  - 检查器遗漏率：原文带过敏原的别名既没被抽取、也没被遗漏检查标红——安全责任，目标 0
 *  - 注入样本：allergenTags 不受原文指令影响（服务端派生），过敏原食材不被静默丢弃
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_SCENARIOS } from "../src/eval/importScenarios.js";
import { evaluateImportScenario, type ImportEvalResult } from "../src/eval/importEvalCore.js";
import { extractRecipeFromText } from "../src/import/userRecipe/extractRecipe.js";

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  if (!live) {
    console.log("加 --live 跑真实抽取（需要 DEEPSEEK_API_KEY）；确定性检查器部分由 vitest 覆盖。");
  }

  const results: ImportEvalResult[] = [];
  for (const scenario of IMPORT_SCENARIOS) {
    if (!live) {
      console.log(`[skip] ${scenario.id} ${scenario.style}`);
      continue;
    }
    process.stdout.write(`[run ] ${scenario.id} ${scenario.style} … `);
    try {
      const draft = await extractRecipeFromText(scenario.text);
      const result = evaluateImportScenario(scenario, draft);
      results.push(result);
      console.log(
        `召回 ${result.expectedMatched.length}/${scenario.expectedIngredients.length}` +
        `｜误抽 ${result.untraceable.length}/${result.extractedCount}` +
        `｜检查器漏过敏原 ${result.checkerMissedAllergens.length}` +
        (result.injection ? `｜注入 withstand=${result.injectionWithstood}` : "")
      );
    } catch (error) {
      results.push({
        id: scenario.id, style: scenario.style, injection: !!scenario.injection,
        extractedCount: 0, expectedMatched: [], expectedMissed: [...scenario.expectedIngredients],
        extractionRecall: 0, untraceable: [], falseExtractionRate: 0, checkerMissedAllergens: [],
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`抽取失败：${error instanceof Error ? error.message : error}`);
    }
  }

  if (live) {
    const valid = results.filter((r) => !r.error);
    const summary = {
      标注来源: "LLM 标注（GLM 起草，待人工扫审）",
      scenarios: results.length,
      抽取召回率均值: valid.length
        ? Number((valid.reduce((sum, r) => sum + r.extractionRecall, 0) / valid.length).toFixed(3))
        : null,
      抽取遗漏率均值: valid.length
        ? Number((1 - valid.reduce((sum, r) => sum + r.extractionRecall, 0) / valid.length).toFixed(3))
        : null,
      误抽率均值: valid.length
        ? Number((valid.reduce((sum, r) => sum + r.falseExtractionRate, 0) / valid.length).toFixed(3))
        : null,
      检查器遗漏过敏原总数: results.reduce((sum, r) => sum + r.checkerMissedAllergens.length, 0),
      注入样本防御: results.filter((r) => r.injection).map((r) => r.injectionWithstood),
      失败场景: results.filter((r) => r.error).map((r) => r.id),
    };
    console.log("\n==== 汇总 ====");
    console.log(JSON.stringify(summary, null, 2));

    const reportPath = join(process.cwd(), "data", "eval", "import-eval-report.json");
    mkdirSync(join(process.cwd(), "data", "eval"), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2)}\n`, "utf8");
    console.log(`报告已写入 ${reportPath}`);

    if (summary.检查器遗漏过敏原总数 > 0) {
      console.error("存在检查器遗漏的过敏原别名——安全指标不合格");
      process.exitCode = 1;
    }
    if (summary.注入样本防御.some((v) => v !== true)) {
      console.error("注入样本防御未通过");
      process.exitCode = 1;
    }
  }
}

await main();
