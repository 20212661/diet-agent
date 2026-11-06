/**
 * 单人匹配评测复跑（冻结口径 data/eval/matching-acceptable-v0.json，基线 91.7%）：
 * 同一 matchRecipesDetailed 对 20 个单人场景算 Precision@3。匹配规则变更（护栏/
 * 权重调整）前后各跑一次对照。纯本地算法，不调模型。
 */
process.env.DIET_AGENT_DB_PATH = ":memory:";
process.env.EMBEDDING_PROVIDER = "off";
const store = await import("../src/store/index.js");
const { matchRecipesDetailed } = await import("../src/recipes/recipeMatcher.js");
const { MATCHING_SCENARIOS } = await import("../src/eval/matchingScenarios.js");
const { readFileSync } = await import("node:fs");
const frozen = JSON.parse(readFileSync("data/eval/matching-acceptable-v0.json", "utf8")) as { scenarios: Array<{ id: string; acceptable: string[] }> };
const book = store.getRecipeBookForUser("solo_matching");
let hits = 0, total = 0;
for (const fs of frozen.scenarios) {
  const scenario = MATCHING_SCENARIOS.find((s) => s.id === fs.id)!;
  const outcome = matchRecipesDetailed({
    recipes: book,
    availableIngredients: scenario.availableIngredients.map((n) => ({ name: n, status: "available" as const })),
    shoppingList: [],
    kitchenProfile: { userId: "s", burners: scenario.kitchen.burners, hasOven: scenario.kitchen.hasOven, hasMicrowave: scenario.kitchen.hasMicrowave, hasRiceCooker: scenario.kitchen.hasRiceCooker, cookware: scenario.kitchen.cookware, maxActiveMinutes: scenario.kitchen.maxActiveMinutes, maxTotalMinutes: scenario.kitchen.maxTotalMinutes, tastePreferences: [], cookingPreferences: [], updatedAt: "" },
    feedback: [],
  });
  const acceptable = new Set(fs.acceptable);
  const top3 = outcome.matches.slice(0, 3).map((m) => m.recipe.name);
  const hit = top3.filter((n) => acceptable.has(n)).length;
  hits += hit; total += 3;
  console.log(`${fs.id} ${hit}/3: ${top3.join("、")}${hit < 3 ? "  [集: " + fs.acceptable.join("/") + "]" : ""}`);
}
console.log(`\n单人匹配 P@3 = ${(hits / total * 100).toFixed(1)}%（${hits}/${total}，基线 91.7%）`);
