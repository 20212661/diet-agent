/**
 * 家庭多人匹配评测的候选生成脚本（一次性，PR E）：
 * 对 FAMILY_MATCHING_SCENARIOS 逐个按"谁吃"解析成员，跑 matchRecipesDetailed
 * （与运行时同一实现：并集硬过滤 + 成员口味等权加权），输出 Top-5 候选与
 * 草案 acceptable 的 Precision@3 到 data/eval/matching-family-proposals.json，
 * 供人工复核后冻结为 matching-family-acceptable-v2.json（口径同 matching-review.md：
 * acceptable 由 LLM 起草、人工复核后才可引用）。
 *
 * 用法：npx tsx scripts/run-matching-family.ts
 * 纯本地算法，不调模型、不消耗配额。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 先设 env 再动态 import：数据库模块在顶层就读取 DIET_AGENT_DB_PATH（内存库，不触碰真实数据）
process.env.DIET_AGENT_DB_PATH ||= ":memory:";
process.env.EMBEDDING_PROVIDER ||= "off";

// --strip-preferences：对照模式——成员口味偏好清空（过敏/忌口保留），用于 fam_sc_04
// 验证"场景确实在测口味加权"（口味加成移除后 Top3 应向非口味维度回落）。
const stripPreferences = process.argv.includes("--strip-preferences");

const store = await import("../src/store/index.js");
const { resolveDiningMembers } = await import("../src/services/household.js");
const { matchRecipesDetailed } = await import("../src/recipes/recipeMatcher.js");
const { FAMILY_MATCHING_SCENARIOS } = await import("../src/eval/matchingScenarios.js");

const outputs = FAMILY_MATCHING_SCENARIOS.map((scenario) => {
  // 每场景独立合成用户：成员不跨场景残留
  const userId = `matching_family_${scenario.id}`;
  store.clearUserData(userId);
  for (const member of scenario.household?.members ?? []) {
    store.upsertHouseholdMember(userId, undefined, {
      name: member.name,
      allergies: member.allergies ?? [],
      avoidFoods: member.avoidFoods ?? [],
      preferences: stripPreferences ? [] : member.preferences ?? [],
    });
  }
  const dining = resolveDiningMembers(userId, scenario.household?.dining ?? undefined);
  const profile = {
    ...store.getUserProfile(userId),
    allergies: [...new Set(dining.flatMap((member) => member.allergies))],
    avoidFoods: [...new Set(dining.flatMap((member) => member.avoidFoods))],
  };
  const outcome = matchRecipesDetailed({
    recipes: store.getRecipeBookForUser(userId),
    availableIngredients: scenario.availableIngredients.map((name) => ({ name, status: "available" as const })),
    shoppingList: [],
    kitchenProfile: { userId, burners: scenario.kitchen.burners, hasOven: scenario.kitchen.hasOven,
      hasMicrowave: scenario.kitchen.hasMicrowave, hasRiceCooker: scenario.kitchen.hasRiceCooker,
      cookware: scenario.kitchen.cookware, maxActiveMinutes: scenario.kitchen.maxActiveMinutes,
      maxTotalMinutes: scenario.kitchen.maxTotalMinutes, tastePreferences: [], cookingPreferences: [], updatedAt: "" },
    userProfile: profile,
    diningMembers: dining,
    feedback: [],
  });
  const top5 = outcome.matches.slice(0, 5).map((match) => ({
    name: match.recipe.name,
    score: Math.round(match.score * 10) / 10,
    tasteReasons: match.reasons.filter((reason) => reason.includes("口味")),
  }));
  const acceptable = new Set(scenario.acceptable);
  const hitsInTop3 = top5.slice(0, 3).filter((item) => acceptable.has(item.name)).length;
  return {
    id: scenario.id,
    description: scenario.description,
    dining: dining.map((member) => member.name),
    top5,
    draftAcceptable: scenario.acceptable,
    precisionAt3: Math.round((hitsInTop3 / 3) * 1000) / 1000,
    blocked: [...outcome.blockingReasons],
  };
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "data", "eval",
  stripPreferences ? "matching-family-proposals-no-taste.json" : "matching-family-proposals.json");
// 与冻结文件核对：acceptable 必须与 v0（或指定版本）一致，防止场景源码与冻结集漂移
if (!stripPreferences) {
  const frozenPath = join(root, "data", "eval", "matching-family-acceptable-v2.json");
  const frozen = JSON.parse((await import("node:fs")).readFileSync(frozenPath, "utf8")) as {
    scenarios: Array<{ id: string; acceptable: string[] }>;
  };
  for (const frozenScenario of frozen.scenarios) {
    const live = FAMILY_MATCHING_SCENARIOS.find((item) => item.id === frozenScenario.id)!;
    if (JSON.stringify(live.acceptable) !== JSON.stringify(frozenScenario.acceptable)) {
      throw new Error(`${frozenScenario.id} 的 acceptable 与冻结文件 v0 不一致（源码 ${JSON.stringify(live.acceptable)} vs 冻结 ${JSON.stringify(frozenScenario.acceptable)}）`);
    }
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: "Top-5 由运行时同一 matchRecipesDetailed 生成（并集硬过滤 + 成员口味等权）；draftAcceptable 为 LLM 起草草案，人工复核后冻结为 matching-family-acceptable-v2.json 方可引用。",
  scenarios: outputs,
}, null, 2)}\n`, "utf8");

const avgPrecision = Math.round((outputs.reduce((sum, item) => sum + item.precisionAt3, 0) / outputs.length) * 1000) / 1000;
console.log(`✅ ${outputs.length} 个家庭场景的 Top-5 已写入 ${outPath}${stripPreferences ? "（去口味偏好对照轮）" : ""}`);
console.log(`   草案口径 Precision@3 平均 ${avgPrecision}（仅供参考，冻结前不可引用）`);
for (const item of outputs) {
  console.log(`- ${item.id} [${item.dining.join("+")}] P@3=${item.precisionAt3} Top3: ${item.top5.slice(0, 3).map((t) => t.name).join("、")}`);
}
