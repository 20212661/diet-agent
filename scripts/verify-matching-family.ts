/**
 * 家庭匹配场景 acceptable 草案的约束校验（PR E 标注流程，与评分算法无关）：
 * 对 FAMILY_MATCHING_SCENARIOS 的每道可接受菜做三项独立检查——
 *   ① 必需食材 ⊆ 场景库存 + 常备调料（清单见 PANTRY_STAPLES，保守口径：
 *     不含过敏原载体调料——蚝油/豆瓣酱/香油/花生制品等不算常备）；
 *   ② 与用餐成员（按场景 dining 解析）的过敏/忌口并集无冲突（assessFoodSafety
 *     判定器，非 matchRecipes 评分）；
 *   ③ 时间（active≤maxActive 且 total≤maxTotal）与设备（appliances/cookware ⊆ 厨房）。
 * 不满足的从草案剔除并列出原因，输出审阅表 data/eval/matching-family-review.md
 * 供人工扫审；扫审通过后冻结 acceptable-v0 并计算 P@3。
 *
 * 用法：npx tsx scripts/verify-matching-family.ts（本地纯算法，不调模型）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DIET_AGENT_DB_PATH ||= ":memory:";
process.env.EMBEDDING_PROVIDER ||= "off";

const store = await import("../src/store/index.js");
const { resolveDiningMembers } = await import("../src/services/household.js");
const { assessFoodSafety } = await import("../src/recipes/foodSafety.js");
const { FAMILY_MATCHING_SCENARIOS } = await import("../src/eval/matchingScenarios.js");
const { normalizeIngredientId } = await import("../src/recipes/ingredientTaxonomy.js");

/** 常备调料（保守清单：不含过敏原载体；宁可多剔不放过）。 */
const PANTRY_STAPLES = new Set([
  "盐", "食盐", "食用盐", "糖", "白糖", "冰糖", "生抽", "老抽", "酱油", "醋", "料酒", "食用油", "油",
  "淀粉", "生粉", "水", "温水", "热水", "冷水",
  "葱", "小葱", "大葱", "香葱", "姜", "蒜", "白胡椒粉", "黑胡椒粉", "胡椒粉",
  "五香粉", "花椒", "干辣椒", "八角", "香叶", "桂皮",
  // 常备原料的形态变体（蒜/姜/葱的片末丝蓉、葱花葱段），同属常备范畴
  "蒜片", "姜片", "蒜末", "姜末", "蒜蓉", "姜丝", "葱花", "葱段", "葱白", "剩米饭",
]);

const userId = "matching_family_verify";
const book = store.getRecipeBookForUser(userId);

interface Row {
  scenario: string;
  dish: string;
  verdict: "keep" | "remove";
  reasons: string[];
}

const rows: Row[] = [];
const keptByScenario = new Map<string, string[]>();

for (const scenario of FAMILY_MATCHING_SCENARIOS) {
  store.clearUserData(userId);
  for (const member of scenario.household?.members ?? []) {
    store.upsertHouseholdMember(userId, undefined, {
      name: member.name,
      allergies: member.allergies ?? [],
      avoidFoods: member.avoidFoods ?? [],
      preferences: member.preferences ?? [],
    });
  }
  const dining = resolveDiningMembers(userId, scenario.household?.dining ?? undefined);
  const safetyProfile = {
    allergies: [...new Set(dining.flatMap((member) => member.allergies))],
    avoidFoods: [...new Set(dining.flatMap((member) => member.avoidFoods))],
  };
  const owned = new Set([
    ...scenario.availableIngredients.map((name) => normalizeIngredientId(name)),
    ...scenario.availableIngredients,
  ]);
  const hasPantry = (name: string) => owned.has(name) || owned.has(normalizeIngredientId(name)) || PANTRY_STAPLES.has(name);
  const appliances = new Set(["stove"]);
  if (scenario.kitchen.hasOven) appliances.add("oven");
  if (scenario.kitchen.hasMicrowave) appliances.add("microwave");
  if (scenario.kitchen.hasRiceCooker) appliances.add("rice_cooker");

  const kept: string[] = [];
  for (const dish of scenario.acceptable) {
    const recipe = book.find((item) => item.name === dish);
    const reasons: string[] = [];
    if (!recipe) {
      reasons.push("菜名不在 187 道库内");
    } else {
      const missing = recipe.ingredients.filter((name) => !hasPantry(name));
      if (missing.length > 0) reasons.push(`缺必需食材：${missing.join("、")}`);
      const safety = assessFoodSafety(
        [...recipe.ingredients, ...(recipe.optionalIngredients ?? []), ...(recipe.vegetables ?? []),
          ...(recipe.staples ?? []), ...(recipe.primaryProtein ? [recipe.primaryProtein] : [])],
        safetyProfile, recipe.allergenTags,
      );
      if (safety.status !== "clear") {
        reasons.push(`过敏/忌口并集冲突（在场：${dining.map((member) => member.name).join("、")}）：${[...safety.conflicts, ...safety.possibleAllergenHits].join("、") || safety.status}`);
      }
      if (recipe.activeMinutes > scenario.kitchen.maxActiveMinutes || recipe.totalMinutes > scenario.kitchen.maxTotalMinutes) {
        reasons.push(`超时：active ${recipe.activeMinutes}/${scenario.kitchen.maxActiveMinutes}，total ${recipe.totalMinutes}/${scenario.kitchen.maxTotalMinutes}`);
      }
      const missingAppliances = (recipe.appliances ?? []).filter((item) => !appliances.has(item));
      if (missingAppliances.length > 0) reasons.push(`缺设备：${missingAppliances.join("、")}`);
      const missingCookware = (recipe.cookware ?? []).filter((required) =>
        !scenario.kitchen.cookware.some((ownedWare) =>
          ownedWare.toLowerCase().includes(required.toLowerCase()) || required.toLowerCase().includes(ownedWare.toLowerCase())));
      if (missingCookware.length > 0) reasons.push(`缺厨具：${missingCookware.join("、")}`);
    }
    const verdict = reasons.length === 0 ? "keep" : "remove";
    if (verdict === "keep") kept.push(dish);
    rows.push({ scenario: scenario.id, dish, verdict, reasons });
  }
  keptByScenario.set(scenario.id, kept);
}

// 审阅表输出
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "data", "eval");
mkdirSync(outDir, { recursive: true });
const lines: string[] = [
  "# 家庭匹配场景 acceptable 草案——约束校验审阅表",
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  "校验与评分算法无关，三项约束：① 必需食材 ⊆ 场景库存 + 常备调料（保守清单，不含蚝油/豆瓣酱/香油等过敏原载体）；② 与在场用餐成员的过敏/忌口并集无冲突（assessFoodSafety）；③ 时间/设备/厨具限制。",
  "常备调料清单：" + [...PANTRY_STAPLES].join("、"),
  "",
];
for (const scenario of FAMILY_MATCHING_SCENARIOS) {
  const kept = keptByScenario.get(scenario.id)!;
  lines.push(`## ${scenario.id}：${scenario.description}`);
  lines.push(`- 在场成员：${resolveDiningMembersLabel(scenario.id)}`);
  lines.push(`- 校验后保留 ${kept.length} 道：${kept.join("、") || "（全被剔除，需人工补标）"}`);
  for (const row of rows.filter((item) => item.scenario === scenario.id)) {
    lines.push(`- ${row.verdict === "keep" ? "✅" : "❌"} ${row.dish}${row.reasons.length ? `——${row.reasons.join("；")}` : ""}`);
  }
  lines.push("");
}
function resolveDiningMembersLabel(id: string): string {
  const scenario = FAMILY_MATCHING_SCENARIOS.find((item) => item.id === id)!;
  const members = scenario.household?.members ?? [];
  const present = scenario.household?.dining ?? ["我", ...members.map((member) => member.name)];
  return present.filter((name) => name === "我" || members.some((member) => member.name === name)).join("、");
}

const outPath = join(outDir, "matching-family-review.md");
writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");

const removed = rows.filter((row) => row.verdict === "remove");
console.log(`✅ 审阅表已写入 ${outPath}`);
console.log(`   保留 ${rows.length - removed.length}/${rows.length} 道（剔除 ${removed.length} 道）`);
for (const row of removed) {
  console.log(`   ❌ ${row.scenario} ${row.dish}——${row.reasons.join("；")}`);
}
