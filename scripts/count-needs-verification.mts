// needs_verification 面统计（修复 A 前后对比用）：10 类过敏用户 × 全库菜谱
// 的 assessFoodSafety 判定计数。只读种子 json + 纯函数（无 DB 依赖），
// 便于在 master worktree 里以同一脚本跑 before 基线。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { assessFoodSafety } = await import("../src/recipes/foodSafety.js");
const { deriveRecipeIngredientMetadata } = await import("../src/recipes/ingredientTaxonomy.js");

interface SeedRecipe {
  name: string;
  ingredients: string[];
  optionalIngredients?: string[];
  vegetables?: string[];
  staples?: string[];
  primaryProtein?: string;
}

const root = process.cwd();
const seed = JSON.parse(readFileSync(join(root, "src", "recipes", "recipeSeed.json"), "utf8")) as SeedRecipe[];
const htcDoc = JSON.parse(readFileSync(join(root, "src", "recipes", "imported", "howtocook.json"), "utf8")) as { recipes: SeedRecipe[] };
const recipes = [...seed, ...htcDoc.recipes];

const ALLERGY_USERS: Array<{ label: string; allergies: string[] }> = [
  { label: "花生", allergies: ["花生"] },
  { label: "虾(甲壳类)", allergies: ["虾"] },
  { label: "鸡蛋", allergies: ["鸡蛋"] },
  { label: "牛奶", allergies: ["牛奶"] },
  { label: "大豆", allergies: ["大豆"] },
  { label: "小麦/麸质", allergies: ["小麦"] },
  { label: "鱼类", allergies: ["鱼"] },
  { label: "芝麻", allergies: ["芝麻"] },
  { label: "坚果", allergies: ["坚果"] },
  { label: "香菜(忌口)", allergies: [], }, // 占位：忌口用户走 avoidFoods
];
const results: Record<string, { conflict: number; needsVerification: number; total: number }> = {};
for (const user of ALLERGY_USERS) {
  let conflict = 0;
  let needsVerification = 0;
  for (const recipe of recipes) {
    const face = [
      ...recipe.ingredients, ...(recipe.optionalIngredients ?? []),
      ...(recipe.vegetables ?? []), ...(recipe.staples ?? []),
      ...(recipe.primaryProtein ? [recipe.primaryProtein] : []),
    ];
    const tags = deriveRecipeIngredientMetadata(face).allergenTags;
    const verdict = assessFoodSafety(face, { allergies: user.allergies }, tags).status;
    if (verdict === "conflict") conflict += 1;
    if (verdict === "needs_verification") needsVerification += 1;
  }
  results[user.label] = { conflict, needsVerification, total: recipes.length };
}
const flag = process.argv.includes("--after") ? "after" : "before";
const { mkdirSync, writeFileSync } = await import("node:fs");
const out = join(root, "data", "eval", `needs-verification-${flag}.json`);
mkdirSync(join(root, "data", "eval"), { recursive: true });
writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), recipes: recipes.length, results }, null, 2)}
`);
console.log(`${flag}: ${recipes.length} 道菜 → ${out}`);
for (const [label, r] of Object.entries(results)) {
  console.log(`  ${label.padEnd(10)} conflict=${String(r.conflict).padStart(3)}  needs_verification=${String(r.needsVerification).padStart(3)}`);
}
