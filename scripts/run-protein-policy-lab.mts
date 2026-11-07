/**
 * 修复 B 对照实验：缺主要蛋白的四种处理（penalty10=现状基线 / penalty30 /
 * exclude / shop_group）× 冻结集（单人 v0 + 家庭 v2），实测选型。
 * 另统计 primaryProtein 解析面：field（导入字段）/ inferred（规则推断）/ 无。
 * 纯本地算法，不调模型。
 */
import { readFileSync } from "node:fs";
process.env.DIET_AGENT_DB_PATH ||= ":memory:";
process.env.EMBEDDING_PROVIDER ||= "off";

const store = await import("../src/store/index.js");
const matcher = await import("../src/recipes/recipeMatcher.js");
const matchRecipesDetailed = matcher.matchRecipesDetailed;
type MatchRecipeInput = matcher.MatchRecipeInput;
const { MATCHING_SCENARIOS, FAMILY_MATCHING_SCENARIOS } = await import("../src/eval/matchingScenarios.js");
const { resolveDiningMembers } = await import("../src/services/household.js");
const { resolvePrimaryProtein } = await import("../src/recipes/proteinInference.js");

const book = store.getRecipeBookForUser("policy_lab");

// ---- primaryProtein 解析面统计 ----
let field = 0, inferred = 0, none = 0;
const inferredExamples: string[] = [];
for (const recipe of book) {
  const protein = resolvePrimaryProtein(recipe);
  if (!protein) { none += 1; continue; }
  if (protein.source === "field") field += 1;
  else { inferred += 1; if (inferredExamples.length < 8) inferredExamples.push(`${recipe.name}→${protein.value}`); }
}
console.log(`== primaryProtein 解析面（${book.length} 道）==`);
console.log(`  字段（导入抽取）: ${field}；规则推断: ${inferred}（例：${inferredExamples.join("、")}）；推断不出: ${none}`);

// ---- 四组对照 ----
const soloFrozen = (JSON.parse(readFileSync("data/eval/matching-acceptable-v0.json", "utf8")) as {
  scenarios: Array<{ id: string; acceptable: string[] }>;
}).scenarios;
const familyFrozen = (JSON.parse(readFileSync("data/eval/matching-family-acceptable-v2.json", "utf8")) as {
  scenarios: Array<{ id: string; acceptable: string[] }>;
}).scenarios;

function runScenario(scenario: (typeof MATCHING_SCENARIOS)[number], household: boolean, policy: string, acceptable: string[]) {
  const kitchen = scenario.kitchen;
  const input: MatchRecipeInput = {
    recipes: book,
    availableIngredients: scenario.availableIngredients.map((name) => ({ name, status: "available" as const })),
    shoppingList: [],
    kitchenProfile: { userId: "lab", burners: kitchen.burners, hasOven: kitchen.hasOven, hasMicrowave: kitchen.hasMicrowave,
      hasRiceCooker: kitchen.hasRiceCooker, cookware: kitchen.cookware, maxActiveMinutes: kitchen.maxActiveMinutes,
      maxTotalMinutes: kitchen.maxTotalMinutes, tastePreferences: [], cookingPreferences: [], updatedAt: "" },
    feedback: [],
    missingPrimaryProteinPolicy: policy as never,
  };
  if (household) {
    const userId = `policy_lab_${scenario.id}`;
    store.clearUserData(userId);
    for (const member of scenario.household?.members ?? []) {
      store.upsertHouseholdMember(userId, undefined, {
        name: member.name, allergies: member.allergies ?? [], avoidFoods: member.avoidFoods ?? [], preferences: member.preferences ?? [],
      });
    }
    const dining = resolveDiningMembers(userId, scenario.household?.dining ?? undefined);
    input.userProfile = { userId, allergies: [...new Set(dining.flatMap((m) => m.allergies))], avoidFoods: [...new Set(dining.flatMap((m) => m.avoidFoods))] };
    input.diningMembers = dining;
  }
  const outcome = matchRecipesDetailed(input);
  const top3 = outcome.matches.slice(0, 3).map((m) => m.recipe.name);
  const hits = top3.filter((n) => acceptable.includes(n)).length;
  return { id: scenario.id, hits, total: 3, top3, needsShopping: outcome.needsShopping.map((m) => m.recipe.name) };
}

const POLICIES = ["penalty10", "penalty30", "exclude", "shop_group"] as const;
console.log(`\n== 四组对照（冻结集：单人 v0 ${soloFrozen.length} 场景 + 家庭 v2 ${familyFrozen.length} 场景）==`);
for (const policy of POLICIES) {
  let soloHits = 0, famHits = 0;
  const changedScenarios: string[] = [];
  const fam04: ReturnType<typeof runScenario> | undefined = undefined;
  void fam04;
  for (const frozen of soloFrozen) {
    const scenario = MATCHING_SCENARIOS.find((s) => s.id === frozen.id)!;
    const r = runScenario(scenario, false, policy, frozen.acceptable);
    soloHits += r.hits;
  }
  let fam04Result: { top3: string[] } | undefined;
  for (const frozen of familyFrozen) {
    const scenario = FAMILY_MATCHING_SCENARIOS.find((s) => s.id === frozen.id)!;
    const r = runScenario(scenario as never, true, policy, frozen.acceptable);
    famHits += r.hits;
    if (r.id === "fam_sc_04") fam04Result = { top3: r.top3 };
  }
  const soloP = (soloHits / (soloFrozen.length * 3) * 100).toFixed(1);
  const famP = (famHits / (familyFrozen.length * 3) * 100).toFixed(1);
  console.log(`[${policy}] 单人 P@3=${soloP}% 家庭 P@3=${famP}%${fam04Result ? ` | fam_sc_04 Top3: ${fam04Result.top3.join("、")}` : ""}`);
  void changedScenarios;
}

// penalty10 基线的场景级明细（与后续组对比用）
console.log(`\n== 基线（penalty10）逐场景明细 ==`);
for (const frozen of soloFrozen) {
  const scenario = MATCHING_SCENARIOS.find((s) => s.id === frozen.id)!;
  const r = runScenario(scenario, false, "penalty10", frozen.acceptable);
  if (r.hits < 3) console.log(`  ${r.id} ${r.hits}/3: ${r.top3.join("、")}`);
}
