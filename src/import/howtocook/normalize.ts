/**
 * 食材写法规范化（P1 只做确定性部分）+ 分类表覆盖率判定。
 *
 * - 剥括号注释（"干辣椒（或者二荆条）"→"干辣椒"），注释保留供 P2 参考
 * - 小词表把英文调料写法折算成中文（soy sauce→生抽酱油 等）
 * - "热干面特有的碱水面"这类描述性前缀属于语义判断，留给 P2 人工/LLM，
 *   P1 只按现有写法查表统计覆盖率
 */

const EN_ALIAS: Readonly<Record<string, string>> = {
  "soy sauce": "生抽酱油",
  "dark soy sauce": "老抽",
  "vinegar": "醋",
  "sugar": "糖",
  "salt": "盐",
  "cooking wine": "料酒",
  "starch": "淀粉",
  "oil": "油",
  "sesame oil": "芝麻油",
  "pepper": "胡椒",
  "garlic": "蒜",
  "ginger": "姜",
  "scallion": "葱",
  "water": "水",
  "egg": "鸡蛋",
};

export interface NormalizedIngredient {
  /** 规范化后的写法（剥注释/英文折算） */
  normalized: string;
  /** 被剥离的括号注释，供 P2 参考 */
  note: string | undefined;
}

export function normalizeIngredientText(raw: string): NormalizedIngredient {
  let text = raw.trim();
  const noteMatch = text.match(/（([^）]*)）/);
  text = text.replace(/（[^）]*）/g, "").trim();
  const lower = text.toLowerCase();
  if (EN_ALIAS[lower]) text = EN_ALIAS[lower]!;
  return { normalized: text, note: noteMatch?.[1] };
}
