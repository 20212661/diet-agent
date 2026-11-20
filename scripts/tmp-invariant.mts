import { readFileSync } from "node:fs";
const { splitJoinedIngredients, deriveRecipeIngredientMetadata } = await import("../src/recipes/ingredientTaxonomy.js");
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const htc = load("src/recipes/imported/howtocook.json") as { recipes: Array<Record<string, unknown>> };
const seed = load("src/recipes/recipeSeed.json") as Array<Record<string, unknown>>;
const FIELDS = ["ingredients", "optionalIngredients", "vegetables", "staples"] as const;
let affected = 0, decreased = 0;
const addedTags = new Map<string, string[]>();
for (const recipe of [...htc.recipes, ...seed]) {
  const before = deriveRecipeIngredientMetadata(FIELDS.flatMap((f) => (recipe[f] as string[] | undefined) ?? []).concat(recipe.primaryProtein ? [recipe.primaryProtein as string] : [])).allergenTags;
  const splitFace = FIELDS.flatMap((f) => splitJoinedIngredients((recipe[f] as string[] | undefined) ?? [])).concat(recipe.primaryProtein ? [recipe.primaryProtein as string] : []);
  const after = deriveRecipeIngredientMetadata(splitFace).allergenTags;
  const removed = before.filter((t) => !after.includes(t));
  const added = after.filter((t) => !before.includes(t));
  const hasSplit = FIELDS.some((f) => ((recipe[f] as string[] | undefined) ?? []).some((item) => /、|，|,/.test(item)));
  if (hasSplit) affected += 1;
  if (added.length) addedTags.set(String(recipe.name), added);
  if (removed.length) {
    decreased += 1;
    console.log(`✗ 减少 ${recipe.name}: 拆前=[${before}] 拆后=[${after}] 移除=${removed}`);
  }
}
console.log(`\n受影响（含连写食材）菜谱：${affected} 道（共 ${htc.recipes.length + seed.length}）`);
console.log(`不变量违例（allergenTags 减少）：${decreased} 道`);
console.log(`\n新增过敏原标签（${addedTags.size} 道）：`);
for (const [name, tags] of addedTags) console.log(`  ${name}: +${tags.join(",")}`);
