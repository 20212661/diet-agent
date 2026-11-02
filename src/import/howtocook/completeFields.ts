/**
 * P3 LLM 补全：HowToCook 原文没有、种子 schema 需要的结构字段。
 *
 * 硬约束（P2 延续）：LLM 只产结构字段，**不得产出 allergenTags /
 * ingredientIds**——两者由 enrich 从分类表派生；ingredients/steps 用
 * 解析原文，不交给 LLM 改写。批量 5 道/请求降低请求数；输出过
 * schema 口径校验 + 确定性交叉检查，失败回传错误重试 1 次，再败进
 * 待处理队列。
 */
import { chatJson } from "./llmClient.js";
import type { HtcRawRecipe } from "./types.js";

export interface CompletedFields {
  mode: string;
  modes: string[];
  mealTypes: string[];
  suitableGoals: string[];
  activeMinutes: number;
  totalMinutes: number;
  appliances: string[];
  cookware: string[];
  dishCount: number;
  tasteTags: string[];
  preferenceTags: string[];
  primaryProtein?: string;
  vegetables: string[];
  staples: string[];
  timeline?: string[];
  lowEnergySwap?: string;
}

const MODES = ["quick", "oven", "stovetop", "one_pot", "low_energy", "prep", "freezer_reuse"];
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const APPLIANCES = ["oven", "stove", "microwave", "rice_cooker"];

const SYSTEM_PROMPT = `你是菜谱结构化助手。为每道菜补全结构字段，输出严格 JSON。
字段规则：
- mode/modes：从 ${JSON.stringify(MODES)} 选（quick=快手、one_pot=一锅出、stovetop=明火、oven=烤箱、low_energy=省力、prep=备菜、freezer_reuse=冷冻复用）；modes 是兼容列表，包含 mode。
- mealTypes：从 ${JSON.stringify(MEAL_TYPES)} 选 1-3 个（breakfast 类多为 breakfast）。
- suitableGoals：从 ["fat_loss","muscle_gain","balanced"] 里选适用的。
- activeMinutes：实际动手操作分钟（0-120，不含等待）；totalMinutes：从备料到出锅（1-240）。注意：步骤文本里已提取的分钟数合计是重要参考，totalMinutes 不要与它差太多。
- appliances：从 ${JSON.stringify(APPLIANCES)} 选，只列步骤确实用到的（明火烹饪用 stove）。
- cookware：如 ["炒锅","汤锅"]。
- dishCount：成品的盘数（0-5）。
- tasteTags/preferenceTags：如 ["下饭","少油烟"]；preferenceTags 可从 ["少洗碗","少油烟","烤箱","适合带饭"] 选。
- primaryProtein/vegetables/staples：从食材列表中挑出对应项（原文写法；没有就空，primaryProtein 没有可省略）。
- timeline：字符串数组，按时间顺序的操作摘要（如 ["0-5min 备菜","5-15min 炒制"]）。
- lowEnergySwap：省力替代做法，一句话；没有可省略。
输出 {"items": [{"name": "菜名", ...字段}]},每道输入菜恰一项。`;

function buildUserPrompt(batch: readonly HtcRawRecipe[]): string {
  return batch.map((recipe) => [
    `菜名：${recipe.name}（类别 ${recipe.category}，难度 ${recipe.difficulty} 星）`,
    `食材：${[...recipe.requiredItems, ...(recipe.optionalItems.length > 0 ? [`（可选）${recipe.optionalItems.join("、")}`] : [])].join("、")}`,
    `厨具（解析分离）：${recipe.utensils.join("、") || "未注明"}`,
    `步骤分钟合计：${recipe.stepMinutesTotal ?? "未提取到"} 分钟`,
    `步骤：\n${recipe.steps.slice(0, 12).join("\n")}${recipe.steps.length > 12 ? "\n…" : ""}`,
  ].join("\n")).join("\n\n---\n\n");
}

function sanitizeFields(recipe: HtcRawRecipe, raw: Record<string, unknown>): CompletedFields {
  const pickEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const pickEnumArray = <T extends string>(value: unknown, allowed: readonly T[]): T[] => {
    const list = Array.isArray(value) ? value.filter((item) => allowed.includes(item as T)) : [];
    return [...new Set(list)] as T[];
  };
  const intIn = (value: unknown, min: number, max: number, fallback: number): number => {
    const num = Number(value);
    return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
  };
  const stringArray = (value: unknown): string[] =>
    (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []).map((item) => item.trim());

  const mode = pickEnum(raw.mode, MODES, "stovetop");
  const mealTypes = pickEnumArray(raw.mealTypes, MEAL_TYPES);
  const modes = pickEnumArray(raw.modes, MODES);
  const appliances = pickEnumArray(raw.appliances, APPLIANCES);
  const activeMinutes = intIn(raw.activeMinutes, 0, 120, 20);
  const totalMinutes = intIn(raw.totalMinutes, 1, 240, Math.max(30, Math.min(240, recipe.stepMinutesTotal ?? 30)));
  return {
    mode,
    modes: modes.length > 0 && modes.includes(mode) ? modes : [...new Set([mode, ...modes])],
    mealTypes: mealTypes.length > 0 ? mealTypes : ["dinner"],
    suitableGoals: stringArray(raw.suitableGoals).length > 0 ? stringArray(raw.suitableGoals) : ["balanced"],
    activeMinutes: Math.min(activeMinutes, totalMinutes),
    totalMinutes: Math.max(totalMinutes, activeMinutes),
    appliances,
    cookware: stringArray(raw.cookware),
    dishCount: intIn(raw.dishCount, 0, 5, 1),
    tasteTags: stringArray(raw.tasteTags),
    preferenceTags: stringArray(raw.preferenceTags),
    primaryProtein: typeof raw.primaryProtein === "string" && raw.primaryProtein.trim() ? raw.primaryProtein.trim() : undefined,
    vegetables: stringArray(raw.vegetables),
    staples: stringArray(raw.staples),
    timeline: stringArray(raw.timeline).length > 0 ? stringArray(raw.timeline) : undefined,
    lowEnergySwap: typeof raw.lowEnergySwap === "string" && raw.lowEnergySwap.trim() ? raw.lowEnergySwap.trim() : undefined,
  };
}

/** 交叉检查：LLM 输出与解析事实的确定性校验，返回问题列表（空=通过）。 */
export function crossCheck(recipe: HtcRawRecipe, fields: CompletedFields): string[] {
  const problems: string[] = [];
  const stepsText = recipe.steps.join("\n");
  // 1) 步骤提到电器但 appliances 没声明
  if (stepsText.includes("烤箱") && !fields.appliances.includes("oven")) problems.push("步骤提到烤箱但 appliances 缺 oven");
  if (stepsText.includes("微波") && !fields.appliances.includes("microwave")) problems.push("步骤提到微波炉但 appliances 缺 microwave");
  if (stepsText.includes("电饭煲") && !fields.appliances.includes("rice_cooker")) problems.push("步骤提到电饭煲但 appliances 缺 rice_cooker");
  // 2) active ≤ total（sanitize 已保证，双保险）
  if (fields.activeMinutes > fields.totalMinutes) problems.push("activeMinutes > totalMinutes");
  // 3) 耗时一致性：totalMinutes 与步骤分钟合计差超出容差（并行±20 / 额外备料+45）
  if (recipe.stepMinutesTotal !== undefined) {
    if (fields.totalMinutes < recipe.stepMinutesTotal - 20 || fields.totalMinutes > recipe.stepMinutesTotal + 45) {
      problems.push(`totalMinutes=${fields.totalMinutes} 与步骤分钟合计 ${recipe.stepMinutesTotal} 不一致（容差 [-20,+45]）`);
    }
  }
  return problems;
}

export async function completeFields(
  recipes: readonly HtcRawRecipe[],
  batchSize = 5,
): Promise<Array<{ recipe: HtcRawRecipe; fields: CompletedFields | undefined; problems: string[]; retried: boolean }>> {
  const results: Array<{ recipe: HtcRawRecipe; fields: CompletedFields | undefined; problems: string[]; retried: boolean }> = [];
  for (let start = 0; start < recipes.length; start += batchSize) {
    const batch = recipes.slice(start, start + batchSize);
    const prompt = buildUserPrompt(batch);
    let retried = false;
    let parsed: Map<string, Record<string, unknown>> | undefined;
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const response = await chatJson<{ items: Array<Record<string, unknown>> }>(SYSTEM_PROMPT, attempt === 0 ? prompt : `${prompt}\n\n上次输出存在以下问题，请修正后重新输出全部条目：${results.filter((r) => r.problems.length > 0).flatMap((r) => r.problems).join("；") || "JSON 结构不完整"}`);
        const map = new Map<string, Record<string, unknown>>();
        for (const item of response.items ?? []) {
          if (typeof item.name === "string") map.set(item.name, item);
        }
        if (batch.every((recipe) => map.has(recipe.name))) {
          parsed = map;
          break;
        }
        retried = true;
      } catch {
        retried = true;
      }
    }
    for (const recipe of batch) {
      const raw = parsed?.get(recipe.name);
      if (!raw) {
        results.push({ recipe, fields: undefined, problems: ["LLM 批次输出未覆盖该菜（重试后仍缺）"], retried });
        continue;
      }
      const fields = sanitizeFields(recipe, raw);
      const problems = crossCheck(recipe, fields);
      results.push({ recipe, fields: problems.length === 0 ? fields : undefined, problems, retried });
    }
  }
  return results;
}
