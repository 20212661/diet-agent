import type { AllergenId } from "../types/diet.js";

interface IngredientDefinition {
  id: string;
  aliases: readonly string[];
  allergens?: readonly AllergenId[];
}

export const INGREDIENT_DEFINITIONS: readonly IngredientDefinition[] = [
  { id: "allergen_peanut", aliases: ["花生类", "花生过敏"], allergens: ["peanut"] },
  { id: "allergen_tree_nut", aliases: ["树坚果", "坚果过敏"], allergens: ["tree_nut"] },
  { id: "allergen_shellfish", aliases: ["甲壳类", "贝类", "甲壳动物"], allergens: ["shellfish"] },
  { id: "allergen_wheat", aliases: ["小麦", "麸质", "面筋"], allergens: ["wheat", "gluten"] },
  { id: "allergen_fish", aliases: ["鱼类"], allergens: ["fish"] },
  { id: "allergen_soy", aliases: ["大豆", "豆制品"], allergens: ["soy"] },
  { id: "allergen_milk", aliases: ["奶制品类过敏", "乳糖", "乳糖不耐受"], allergens: ["milk"] },
  { id: "allergen_egg", aliases: ["蛋类", "鸡蛋过敏"], allergens: ["egg"] },
  { id: "peanut", aliases: ["花生", "花生油", "花生酱", "花生碎"], allergens: ["peanut"] },
  { id: "tree_nut", aliases: ["核桃", "杏仁", "腰果", "榛子"], allergens: ["tree_nut"] },
  { id: "egg", aliases: ["鸡蛋", "蛋液", "蛋黄酱", "蛋丝", "皮蛋"], allergens: ["egg"] },
  { id: "milk", aliases: ["牛奶", "乳制品", "奶油", "黄油", "芝士", "奶酪"], allergens: ["milk"] },
  { id: "tofu", aliases: ["内酯豆腐", "豆腐"], allergens: ["soy"] },
  { id: "fermented_tofu", aliases: ["红腐乳", "腐乳"], allergens: ["soy"] },
  { id: "soy_sauce", aliases: ["生抽", "老抽", "酱油", "豆瓣酱", "黄豆酱", "甜面酱"], allergens: ["soy", "wheat", "gluten"] },
  { id: "oyster_sauce", aliases: ["蚝油", "蚝油汁"], allergens: ["shellfish", "soy", "wheat", "gluten"] },
  { id: "wheat_noodle", aliases: ["面条"], allergens: ["wheat", "gluten"] },
  { id: "wheat_wrapper", aliases: ["冷冻饺子", "冷冻馄饨", "冷冻葱油饼"], allergens: ["wheat", "gluten"] },
  { id: "tuna", aliases: ["金枪鱼罐头"], allergens: ["fish"] },
  { id: "sole", aliases: ["龙利鱼"], allergens: ["fish"] },
  { id: "perch", aliases: ["鲈鱼"], allergens: ["fish"] },
  { id: "hairtail", aliases: ["带鱼"], allergens: ["fish"] },
  { id: "fish", aliases: ["鱼"], allergens: ["fish"] },
  { id: "prawn", aliases: ["基围虾", "大虾", "虾"], allergens: ["shellfish"] },
  { id: "shrimp_meat", aliases: ["虾仁"], allergens: ["shellfish"] },
  { id: "dried_shrimp", aliases: ["虾皮"], allergens: ["shellfish"] },
  { id: "clam", aliases: ["花蛤"], allergens: ["shellfish"] },
  { id: "squid", aliases: ["鱿鱼"], allergens: ["shellfish"] },
  { id: "sesame", aliases: ["白芝麻", "芝麻", "香油"], allergens: ["sesame"] },
  { id: "tomato", aliases: ["小番茄", "西红柿", "番茄"] },
  { id: "rice", aliases: ["糙米饭", "米饭", "杂粮饭", "糙米", "大米"] },
  { id: "oats", aliases: ["燕麦粥", "燕麦"] },
  { id: "bread", aliases: ["全麦面包", "吐司"], allergens: ["wheat", "gluten"] },
  { id: "soy_milk", aliases: ["豆浆"], allergens: ["soy"] },
  { id: "broccoli", aliases: ["西兰花"] },
  { id: "sweet_potato", aliases: ["紫薯"] },
  { id: "corn", aliases: ["玉米"] },
  { id: "lettuce", aliases: ["生菜", "油麦菜", "蔬菜沙拉"] },
  { id: "banana", aliases: ["香蕉"] },
  { id: "apple", aliases: ["苹果"] },
  { id: "blueberry", aliases: ["蓝莓"] },
  { id: "avocado", aliases: ["牛油果"] },
  { id: "salmon", aliases: ["三文鱼"], allergens: ["fish"] },
  { id: "protein_powder", aliases: ["蛋白粉"], allergens: ["milk", "soy"] },
  { id: "yogurt", aliases: ["酸奶"], allergens: ["milk"] },
  { id: "mixed_nuts", aliases: ["坚果一小把", "坚果"], allergens: ["tree_nut", "peanut"] },
  { id: "noodles", aliases: ["汤面"], allergens: ["wheat", "gluten"] },
  { id: "vegetable_bun", aliases: ["蔬菜包"], allergens: ["wheat", "gluten", "soy"] },
  { id: "vegetables", aliases: ["蔬菜", "青菜"] },
  { id: "pork_lean", aliases: ["瘦肉"] },
  { id: "staple_unspecified", aliases: ["杂粮", "主食"] },
  { id: "pasta", aliases: ["意面"], allergens: ["wheat", "gluten"] },
  { id: "soup", aliases: ["豆腐蔬菜汤"], allergens: ["soy"] },
  { id: "whole_chicken", aliases: ["三黄鸡"] },
  { id: "chicken_breast", aliases: ["鸡胸肉"] },
  { id: "chicken_thigh", aliases: ["鸡腿"] },
  { id: "chicken_wing", aliases: ["鸡翅"] },
  { id: "chicken", aliases: ["鸡肉"] },
  { id: "beef", aliases: ["肥牛卷", "牛腩", "牛肉"] },
  { id: "pork", aliases: ["猪里脊", "猪肉末", "梅花肉", "五花肉", "肉丝", "肉末", "排骨", "猪肉"] },
  { id: "potato", aliases: ["土豆", "马铃薯"] },
  { id: "onion", aliases: ["洋葱"] },
  { id: "carrot", aliases: ["胡萝卜", "红萝卜"] },
  { id: "mushroom", aliases: ["蘑菇"] },
  { id: "asparagus", aliases: ["芦笋"] },
  { id: "garlic", aliases: ["蒜", "大蒜", "蒜瓣"] },
  { id: "bell_pepper", aliases: ["青椒", "红椒", "甜椒"] },
  { id: "scallion", aliases: ["葱", "大葱", "小葱", "葱花"] },
  { id: "seaweed", aliases: ["海苔", "紫菜"] },
  { id: "dumpling_wrapper", aliases: ["饺子皮", "馄饨皮"], allergens: ["wheat", "gluten"] },
  { id: "shiitake", aliases: ["香菇", "干香菇"] },
  { id: "ginger", aliases: ["姜", "姜丝"] },
  { id: "star_anise", aliases: ["八角", "大料"] },
  { id: "pea", aliases: ["豌豆"] },
  { id: "olive_oil", aliases: ["橄榄油"] },
  { id: "chili", aliases: ["辣椒", "干辣椒"] },
  { id: "sugar", aliases: ["糖", "白糖", "红糖"] },
  { id: "red_date", aliases: ["红枣"] },
  { id: "goji", aliases: ["枸杞"] },
  { id: "celery", aliases: ["芹菜"] },
  { id: "enoki", aliases: ["金针菇"] },
  { id: "garlic_sprout", aliases: ["蒜苗"] },
  { id: "eggplant", aliases: ["茄子"] },
  { id: "wood_ear", aliases: ["木耳", "黑木耳"] },
  { id: "bamboo_shoot", aliases: ["笋", "竹笋"] },
  { id: "cucumber", aliases: ["黄瓜"] },
  { id: "honey", aliases: ["蜂蜜"] },
  { id: "cabbage", aliases: ["白菜"] },
  { id: "peppercorn", aliases: ["花椒"] },
  { id: "cilantro", aliases: ["香菜"] },
  { id: "cola", aliases: ["可乐"] },
  { id: "lemon", aliases: ["柠檬"] },
  { id: "black_pepper", aliases: ["黑胡椒"] },
  { id: "gardenia", aliases: ["黄栀子"] },
  { id: "duck", aliases: ["鸭肉"] },
  { id: "green_beans", aliases: ["四季豆"] },
  { id: "pork_lard", aliases: ["猪油"] },
  { id: "pumpkin", aliases: ["南瓜"] },
  { id: "millet", aliases: ["小米"] },
  { id: "flour", aliases: ["面粉"], allergens: ["wheat", "gluten"] },
] as const;

/** Unresolved seed names stay blocked for allergy-sensitive recommendations. */
export const UNRESOLVED_RECIPE_INGREDIENTS: Readonly<Record<string, string>> = {
  "饺子（肉馅）": "肉馅成分未注明",
  "馄饨（肉馅）": "馅料成分未注明",
  "火腿": "加工配料未注明",
  "培根": "腌制配料未注明",
  "肉松": "加工配料未注明",
  "榨菜": "加工配料未注明",
  "粉丝": "淀粉来源未注明",
  "粉条": "淀粉来源未注明",
  "淀粉": "植物来源未注明",
  "豆芽": "豆类品种未注明",
  "青豆": "豆类品种未注明",
  "红油": "油料和调味配方未注明",
  "叉烧酱": "品牌配方未注明",
  "咖喱块": "品牌配方未注明",
  "啤酒": "谷物配方未注明",
  "醋": "谷物来源未注明",
};

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[\s_\-、，,（）()]/g, "").trim();
}

const aliasEntries = INGREDIENT_DEFINITIONS
  .flatMap((definition) => definition.aliases.map((alias) => ({
    alias: normalizedText(alias),
    definition,
  })))
  .sort((left, right) => right.alias.length - left.alias.length);

export function normalizeIngredientId(name: string): string {
  const normalized = normalizedText(name);
  const matched = aliasEntries.find(({ alias }) => normalized === alias || normalized.includes(alias));
  return matched?.definition.id ?? `ingredient:${normalized}`;
}

export function resolveAllergenIds(names: readonly string[]): AllergenId[] {
  const allergens = new Set<AllergenId>();
  for (const name of names) {
    const normalized = normalizedText(name);
    for (const { alias, definition } of aliasEntries) {
      if (normalized === alias || normalized.includes(alias) || alias.includes(normalized)) {
        for (const allergen of definition.allergens ?? []) allergens.add(allergen);
      }
    }
    if (isAllergenId(normalized)) allergens.add(normalized);
  }
  return [...allergens].sort();
}

export function deriveRecipeIngredientMetadata(
  ingredients: readonly string[]
): { ingredientIds: string[]; allergenTags: AllergenId[] } {
  return {
    ingredientIds: [...new Set(ingredients.map(normalizeIngredientId))].sort(),
    allergenTags: resolveAllergenIds(ingredients),
  };
}

export function validateIngredientTaxonomy(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const aliases = new Set<string>();
  for (const definition of INGREDIENT_DEFINITIONS) {
    if (ids.has(definition.id)) errors.push(`Duplicate ingredient id: ${definition.id}`);
    ids.add(definition.id);
    if (definition.aliases.length === 0) errors.push(`Ingredient has no aliases: ${definition.id}`);
    for (const alias of definition.aliases) {
      const normalized = normalizedText(alias);
      if (!normalized) errors.push(`Empty ingredient alias: ${definition.id}`);
      if (aliases.has(normalized)) errors.push(`Duplicate ingredient alias: ${alias}`);
      aliases.add(normalized);
    }
  }
  return errors;
}

export function isAllergenId(value: string): value is AllergenId {
  return ["peanut", "tree_nut", "milk", "egg", "soy", "wheat", "gluten", "fish", "shellfish", "sesame"]
    .includes(value);
}
