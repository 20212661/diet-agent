import type { AllergenId } from "../types/diet.js";
import { HTC_ALIAS_EXTENSIONS, HTC_INGREDIENT_DEFINITIONS } from "./ingredientTaxonomyHowToCook.js";

export interface IngredientDefinition {
  id: string;
  aliases: readonly string[];
  allergens?: readonly AllergenId[];
  /**
   * "可能含"过敏原：配方因品牌/工艺而异、无法确定不含（鸡精的蛋、
   * 只写"醋"的谷物麸皮）。判定时按失败即关闭处理——对相应过敏用户
   * 返回 needs_verification 并从推荐中拦下，宁可少推荐不冒险。
   */
  possibleAllergens?: readonly AllergenId[];
}

/** 人工维护的种子分类表（HowToCook 导入条目在 ingredientTaxonomyHowToCook.ts，由管道生成）。 */
export const BASE_INGREDIENT_DEFINITIONS: readonly IngredientDefinition[] = [
  { id: "allergen_peanut", aliases: ["花生类", "花生过敏"], allergens: ["peanut"] },
  { id: "allergen_tree_nut", aliases: ["树坚果", "坚果过敏"], allergens: ["tree_nut"] },
  { id: "allergen_shellfish", aliases: ["甲壳类", "贝类", "甲壳动物"], allergens: ["shellfish"] },
  { id: "allergen_wheat", aliases: ["小麦", "麸质", "面筋"], allergens: ["wheat", "gluten"] },
  { id: "allergen_fish", aliases: ["鱼类"], allergens: ["fish"] },
  { id: "allergen_soy", aliases: ["大豆", "豆制品"], allergens: ["soy"] },
  { id: "allergen_milk", aliases: ["奶制品类过敏", "乳糖", "乳糖不耐受"], allergens: ["milk"] },
  { id: "allergen_egg", aliases: ["蛋类", "鸡蛋过敏"], allergens: ["egg"] },
  { id: "peanut", aliases: ["花生", "花生碎"], allergens: ["peanut"] },
  { id: "tree_nut", aliases: ["核桃", "杏仁", "腰果", "榛子"], allergens: ["tree_nut"] },
  { id: "egg", aliases: ["鸡蛋", "蛋液", "沙拉酱", "蛋丝", "皮蛋", "蛋", "蛋清", "蛋黄"], allergens: ["egg"] },
  { id: "milk", aliases: ["牛奶", "乳制品", "奶油", "黄油", "芝士", "奶酪"], allergens: ["milk"] },
  { id: "tofu", aliases: ["内酯豆腐", "豆腐"], allergens: ["soy"] },
  { id: "fermented_tofu", aliases: ["红腐乳", "腐乳"], allergens: ["soy"] },
  // 豆瓣酱按"宁可多拦"保留 soy：郫县豆瓣主料蚕豆+小麦粉（蚕豆≠大豆，wheat 确定），
  // 但部分品牌含豆粕/酱油，摘掉 soy 会变成安全漏洞；盲标口径 wheat 确定/soy 待定
  // （allergenGold unsure），经人工裁决保留 soy，代价仅大豆过敏用户多拦 3 道菜。
  { id: "soy_sauce", aliases: ["生抽", "老抽", "酱油", "豆瓣酱", "黄豆酱", "甜面酱"], allergens: ["soy", "wheat", "gluten"] },
  { id: "oyster_sauce", aliases: ["蚝油", "蚝油汁"], allergens: ["shellfish", "soy", "wheat", "gluten"] },
  { id: "wheat_noodle", aliases: ["面条"], allergens: ["wheat", "gluten"] },
  { id: "wheat_wrapper", aliases: ["冷冻饺子", "冷冻馄饨", "冷冻葱油饼"], allergens: ["wheat", "gluten"] },
  // 原UNRESOLVED 待审项定案（2026-11-02）：皮=小麦确定；肉馅常加大豆蛋白，可能含
  { id: "wonton", aliases: ["馄饨（肉馅）", "饺子（肉馅）"], allergens: ["wheat", "gluten"], possibleAllergens: ["soy"] },
  // 其余原UNRESOLVED 待审项定案（2026-11-02，种子特有写法）：
  // 肉松常加大豆蛋白与酱油（soy 确定、wheat 可能含）；榨菜为芥菜腌制品无常见过敏原；
  // 叉烧酱以酱油/海鲜酱为基（soy/wheat/gluten 确定，部分品牌含芝麻酱）。
  { id: "pork_floss", aliases: ["肉松"], allergens: ["soy"], possibleAllergens: ["wheat"] },
  { id: "zhacai", aliases: ["榨菜"], allergens: [] },
  { id: "char_siu_sauce", aliases: ["叉烧酱"], allergens: ["soy", "wheat", "gluten"], possibleAllergens: ["sesame"] },
  { id: "tuna", aliases: ["金枪鱼罐头", "金枪鱼"], allergens: ["fish"] },
  { id: "sole", aliases: ["龙利鱼"], allergens: ["fish"] },
  { id: "perch", aliases: ["鲈鱼"], allergens: ["fish"] },
  { id: "hairtail", aliases: ["带鱼"], allergens: ["fish"] },
  { id: "fish", aliases: ["鱼", "鱼肉"], allergens: ["fish"] },
  { id: "prawn", aliases: ["基围虾", "大虾", "虾"], allergens: ["shellfish"] },
  { id: "shrimp_meat", aliases: ["虾仁"], allergens: ["shellfish"] },
  { id: "dried_shrimp", aliases: ["虾皮"], allergens: ["shellfish"] },
  { id: "clam", aliases: ["花蛤"], allergens: ["shellfish"] },
  { id: "squid", aliases: ["鱿鱼"], allergens: ["shellfish"] },
  { id: "sesame", aliases: ["白芝麻", "芝麻"], allergens: ["sesame"] },
  { id: "tomato", aliases: ["小番茄", "西红柿", "番茄"] },
  { id: "rice", aliases: ["糙米饭", "米饭", "杂粮饭", "糙米", "大米"] },
  { id: "oats", aliases: ["燕麦粥", "燕麦"] },
  { id: "bread", aliases: ["全麦面包", "吐司", "面包", "面包糠", "面包屑"], allergens: ["wheat", "gluten"] },
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
  { id: "garlic", aliases: ["蒜", "大蒜", "蒜瓣", "蒜粉", "蒜蓉酱/蒜粉"] },
  { id: "bell_pepper", aliases: ["青椒", "红椒", "甜椒", "甜椒粉"] },
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
  { id: "flour", aliases: ["面粉", "小麦粉"], allergens: ["wheat", "gluten"] },
  { id: "curry_roux", aliases: ["咖喱块"], allergens: ["wheat", "gluten"] },
  { id: "chicken_essence", aliases: ["鸡精", "鸡粉"], allergens: ["wheat", "gluten"], possibleAllergens: ["egg"] },
  // ---- 加工品独立条目（2026-11-06 人工确认过敏原口径）----
  // 背景：别名子串匹配曾把"X酱/X油/X粉"劫持到原料 ID（番茄酱→tomato），
  // 匹配侧"库存有 X → X 酱判已有"跨形态误判（bench 实测 21 次/番茄酱类）；
  // 安全侧靠并集"碰对"但漏加工品额外过敏原。条目拆分 + normalizeIngredientId
  // 的后缀护栏（见下方）共同修复。
  // 过敏原确认记录：蛋黄酱=egg 确定、soy 不标（与食用油规则一致）；蒜蓉酱可能含 soy；
  // 番茄酱不标；牛肉酱 soy+wheat 确定；沙茶酱 shellfish/fish/peanut 确定、可能含 sesame；
  // 海鲜酱（hoisin）soy+wheat 确定、可能含 sesame，不标 shellfish/fish（以大豆面粉为主料）；
  // 花生制品（油/酱）继续标 peanut（安全宁可多拦）。
  { id: "peanut_oil", aliases: ["花生油"], allergens: ["peanut"] },
  { id: "peanut_butter", aliases: ["花生酱"], allergens: ["peanut"] },
  { id: "mayonnaise", aliases: ["蛋黄酱"], allergens: ["egg"] },
  { id: "tomato_paste", aliases: ["番茄酱", "蕃茄酱", "番茄酱/茄汁", "茄汁"], allergens: [] },
  { id: "chili_powder", aliases: ["辣椒粉", "干辣椒粉"], allergens: [] },
  { id: "guilin_chili_sauce", aliases: ["桂林辣椒酱"], allergens: [] },
  { id: "garlic_sauce", aliases: ["蒜蓉酱"], allergens: [], possibleAllergens: ["soy"] },
  { id: "sesame_oil", aliases: ["芝麻油", "芝麻香油", "香油"], allergens: ["sesame"] },
  { id: "sesame_paste", aliases: ["芝麻酱"], allergens: ["sesame"] },
  { id: "corn_oil", aliases: ["玉米油"], allergens: [] },
  { id: "corn_starch", aliases: ["玉米淀粉"], allergens: [] },
  { id: "potato_starch", aliases: ["土豆淀粉"], allergens: [] },
  { id: "pea_starch", aliases: ["豌豆淀粉"], allergens: [] },
  { id: "lemon_juice", aliases: ["柠檬汁"], allergens: [] },
  { id: "beef_sauce", aliases: ["牛肉酱"], allergens: ["soy", "wheat"] },
  // 海鲜酱（hoisin）口径在 HTC 表 seafood_sauce：soy/wheat 确定、sesame 可能，不标 shellfish/fish
  { id: "satay_sauce", aliases: ["沙茶酱"], allergens: ["shellfish", "fish", "peanut"], possibleAllergens: ["sesame"] },
] as const;

// 挂靠现有条目的导入别名（生成器保证过敏原集合与现有条目兼容）
const baseWithExtensions: readonly IngredientDefinition[] = BASE_INGREDIENT_DEFINITIONS.map((definition) => {
  const extra = HTC_ALIAS_EXTENSIONS[definition.id];
  return extra ? { ...definition, aliases: [...definition.aliases, ...extra] } : definition;
});

export const INGREDIENT_DEFINITIONS: readonly IngredientDefinition[] = [
  ...baseWithExtensions,
  ...HTC_INGREDIENT_DEFINITIONS,
];

/** Unresolved seed names stay blocked for allergy-sensitive recommendations. */
export const UNRESOLVED_RECIPE_INGREDIENTS: Readonly<Record<string, string>> = {
  // 2026-11-02 清空：HowToCook 分类表扩充后，原 16 项待审食材（火腿/培根/豆芽/粉丝/淀粉/红油/叉烧酱/咖喱块/啤酒/醋…）
  // 已全部建立映射。机制保留：新种子出现未映射食材时，不在此清单即直接 fail（validate:recipes / CI）。
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

// ---- 纯函数记忆化 ----
// 分类表进程内不变，而一次全库匹配（search_recipes / matchRecipes / 周计划验证）
// 会把同一批食材名重复解析几十遍——每名一次 543+ 别名最长优先扫描。记忆化后
// 结果完全一致，只省重复扫描。缓存设上限防用户输入无界增长，满了整体清空
// （重新计算即可，无正确性影响）。
const MEMO_LIMIT = 4096;

function memoized<V>(cache: Map<string, V>, key: string, compute: () => V): V {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = compute();
  if (cache.size >= MEMO_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

const idCache = new Map<string, string>();
const allergenCache = new Map<string, AllergenId[]>();
const possibleAllergenCache = new Map<string, AllergenId[]>();

/**
 * 加工后缀词表：normalized = 别名 + 后缀（如 番茄+酱、土豆+淀粉）时，
 * 该 includes 命中视为"加工品词形被原料别名劫持"，跳过——由加工品独立条目
 * （精确别名）接管。只挡前缀形态（X酱=X+后缀），"朗姆酒或啤酒"这类加工词
 * 在前的连写不受影响。安全侧（resolveAllergenIdsForName）不加护栏：宁可多拦。
 */
const PROCESSED_SUFFIXES = ["酱", "油", "粉", "糖", "盐", "汁", "膏", "醋", "酒", "淀粉"] as const;

function processedVariantOf(normalized: string, alias: string): boolean {
  if (normalized === alias || !normalized.startsWith(alias)) return false;
  return (PROCESSED_SUFFIXES as readonly string[]).includes(normalized.slice(alias.length));
}

export function normalizeIngredientId(name: string): string {
  return memoized(idCache, name, () => {
    const normalized = normalizedText(name);
    const matched = aliasEntries.find(({ alias }) =>
      normalized === alias || (normalized.includes(alias) && !processedVariantOf(normalized, alias)));
    return matched?.definition.id ?? `ingredient:${normalized}`;
  });
}

export type AllergenMatchMode = "user-description" | "ingredient";

/**
 * 把名称解析为过敏原 ID 集合。两种输入的匹配严格度不同：
 *
 * - user-description（默认）：用户的过敏/忌口是自由描述，保持宽松匹配——
 *   用户写"虾"要能命中"虾仁""虾皮"，反向子串（别名包含输入）也放行，
 *   宁可多拦不漏拦。
 * - ingredient：菜谱食材名必须精确。禁止反向子串（曾因"冷冻葱油饼"
 *   包含"葱"把葱判成小麦、"乳糖"包含"糖"把糖判成牛奶、"鱿鱼"包含"鱼"
 *   把鱼判成甲壳类），且子串方向只允许 ≥2 字的别名（"花生酱"包含
 *   "花生"算，单字别名不参与子串）。
 */
export function resolveAllergenIds(
  names: readonly string[],
  mode: AllergenMatchMode = "user-description",
): AllergenId[] {
  const merged = new Set<AllergenId>();
  for (const name of names) {
    for (const allergen of resolveAllergenIdsForName(name, mode)) merged.add(allergen);
  }
  return [...merged].sort();
}

function resolveAllergenIdsForName(name: string, mode: AllergenMatchMode): AllergenId[] {
  return memoized(allergenCache, `${mode}|${name}`, () => {
    const allergens = new Set<AllergenId>();
    const normalized = normalizedText(name);
    for (const { alias, definition } of aliasEntries) {
      const hit = mode === "user-description"
        // 用户侧保持原有宽松匹配（含单字子串与反向子串），宁可多拦。
        ? normalized === alias || normalized.includes(alias) || alias.includes(normalized)
        // 食材侧：精确相等 + ≥2 字别名的子串；禁反向、禁单字子串。
        : normalized === alias || (alias.length >= 2 && normalized.includes(alias));
      if (hit) {
        for (const allergen of definition.allergens ?? []) allergens.add(allergen);
      }
    }
    if (isAllergenId(normalized)) allergens.add(normalized);
    return [...allergens].sort();
  });
}

/**
 * "可能含"过敏原解析：与 resolveAllergenIds 同一套匹配，收集
 * possibleAllergens（配方因品牌而异）。判定时对相应过敏用户按
 * needs_verification 处理（失败即关闭），不计入确定的 allergenTags。
 */
export function resolvePossibleAllergenIds(
  names: readonly string[],
  mode: AllergenMatchMode = "user-description",
): AllergenId[] {
  const merged = new Set<AllergenId>();
  for (const name of names) {
    for (const allergen of memoized(possibleAllergenCache, `${mode}|${name}`, () => {
      const possible = new Set<AllergenId>();
      const normalized = normalizedText(name);
      for (const { alias, definition } of aliasEntries) {
        const hit = mode === "user-description"
          ? normalized === alias || normalized.includes(alias) || alias.includes(normalized)
          : normalized === alias || (alias.length >= 2 && normalized.includes(alias));
        if (hit) {
          for (const allergen of definition.possibleAllergens ?? []) possible.add(allergen);
        }
      }
      return [...possible].sort();
    })) {
      merged.add(allergen);
    }
  }
  return [...merged].sort();
}

export function deriveRecipeIngredientMetadata(
  ingredients: readonly string[]
): { ingredientIds: string[]; allergenTags: AllergenId[] } {
  return {
    ingredientIds: [...new Set(ingredients.map(normalizeIngredientId))].sort(),
    // 菜谱食材用 ingredient 严格模式，杜绝反向子串误报。
    allergenTags: resolveAllergenIds(ingredients, "ingredient"),
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
