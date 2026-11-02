/**
 * P2 规则执行器：把人工定案的规则表 + 第二意见应用到聚类提议，
 * 生成最终判定（approved/allergensFinal/possibleFinal），并导出供
 * 人工扫表的 Markdown 清单。真正的分类表写入在人工扫表通过之后。
 *
 * 规则来源（人工定案，2026-11-02）：
 * R1 料酒 wheat/gluten 确定；R2 鸡精 wheat/gluten 确定 + egg 可能含；
 * R3 醋按品种分（香醋/陈醋确定，米醋/白醋不标，泛写"醋"可能含）；
 * R4 啤酒 gluten 确定 + wheat 可能含；R5 味精不标；R6 未注明种类的
 * 食用油不标（README 限制节写明取舍）；R7 LLM 判为不确定的一律进
 * possibleAllergens（复合调料/加工肉制品等配方因品牌而异）。
 * 其余：A 组采纳 LLM 确定提议（与第二意见一致）；B 组默认通过
 * （LLM 说无过敏原且不命中强词表）。
 */
import type { AllergenId } from "../../types/diet.js";
import type { TaxonomyProposal } from "./clusterPropose.js";

export interface AppliedJudgement {
  canonical: string;
  aliases: string[];
  existingMatch: string | undefined;
  suggestedNewId: string | undefined;
  allergens: AllergenId[];
  possibleAllergens: AllergenId[];
  basis: string;
  occurrences: number;
}

const LEGAL = new Set(["peanut", "tree_nut", "milk", "egg", "soy", "wheat", "gluten", "fish", "shellfish", "sesame"]);

function onlyLegal(values: readonly string[]): AllergenId[] {
  return [...new Set(values.filter((value): value is AllergenId => LEGAL.has(value)))].sort();
}

/** 合并跨批分裂的同名组（如"料酒"两批各一组）：以更严通道（review）为准。 */
export function mergeSplitGroups(proposals: readonly TaxonomyProposal[]): TaxonomyProposal[] {
  const byCanonical = new Map<string, TaxonomyProposal>();
  for (const proposal of proposals) {
    const key = proposal.canonical;
    const existing = byCanonical.get(key);
    if (!existing) {
      byCanonical.set(key, { ...proposal });
      continue;
    }
    existing.aliases = [...new Set([...existing.aliases, ...proposal.aliases])];
    existing.occurrences += proposal.occurrences;
    existing.allergens = [...new Set([...existing.allergens, ...proposal.allergens])];
    existing.suspectedAllergens = [...new Set([...existing.suspectedAllergens, ...proposal.suspectedAllergens])];
    existing.sampleDishes = [...new Set([...existing.sampleDishes, ...proposal.sampleDishes])].slice(0, 3);
    if (proposal.channel === "review") existing.channel = "review";
    existing.suspectWeak = existing.suspectWeak || proposal.suspectWeak;
  }
  return [...byCanonical.values()].sort((a, b) => b.occurrences - a.occurrences);
}

function applyRuleTable(proposal: TaxonomyProposal): { allergens: AllergenId[]; possible: AllergenId[]; basis: string } | undefined {
  const name = proposal.canonical;
  const aliasesText = [name, ...proposal.aliases].join("、");

  // R1 料酒（含黄酒基的写法组；米酒/花雕等另组按 R7）
  if (name === "料酒" || name === "料酒/黄酒") {
    return { allergens: ["gluten", "wheat"], possible: [], basis: "R1 料酒=黄酒麦曲酿造" };
  }
  // R2 鸡精（#21 已落地的载体条目，此处对齐分裂组）
  if (name.includes("鸡精") || name.includes("鸡粉")) {
    return { allergens: ["gluten", "wheat"], possible: ["egg"], basis: "R2 鸡精小麦淀粉确定、全蛋粉可能含" };
  }
  // R3 醋按品种
  if (/(香醋|陈醋|黑醋|熏醋|大红浙醋)/.test(name)) {
    return { allergens: ["gluten", "wheat"], possible: [], basis: "R3 香醋/陈醋麸皮酿造确定" };
  }
  if (/(米醋|白醋|苹果醋|柠檬醋)/.test(name)) {
    return { allergens: [], possible: [], basis: "R3 米醋/白醋不标" };
  }
  if (name === "醋" || (name.endsWith("醋") && !name.includes("酱"))) {
    return { allergens: [], possible: ["gluten", "wheat"], basis: "R3 泛写'醋'按可能含（不能当米醋）" };
  }
  // R4 啤酒
  if (name === "啤酒") {
    return { allergens: ["gluten"], possible: ["wheat"], basis: "R4 大麦芽麸质确定、小麦啤酒可能含" };
  }
  // R5 味精
  if (name === "味精" || name === "谷氨酸钠") {
    return { allergens: [], possible: [], basis: "R5 纯味精不标" };
  }
  // R6 未注明种类的食用油
  if (/^(食用油|植物油|色拉油|菜油|油脂)$/.test(name) || name === "食用油/植物油") {
    return { allergens: [], possible: [], basis: "R6 未注明种类不标（README 限制节写明取舍）" };
  }
  // 料酒/啤酒 混合写法组：并按两者较严处理
  if (name.includes("料酒") && name.includes("啤酒")) {
    return { allergens: ["gluten", "wheat"], possible: [], basis: "R1+R4 料酒/啤酒可互换写法，按含小麦/麸质处理" };
  }
  void aliasesText;
  return undefined;
}

export function applyRules(
  proposals: readonly TaxonomyProposal[],
): { applied: AppliedJudgement[]; readmeTodos: string[] } {
  const merged = mergeSplitGroups(proposals);
  const applied: AppliedJudgement[] = [];

  for (const proposal of merged) {
    if (proposal.canonical === "__UTENSIL__") continue; // 工具误入，不进分类表
    const ruled = applyRuleTable(proposal);
    let allergens: AllergenId[];
    let possible: AllergenId[];
    let basis: string;

    if (ruled) {
      ({ allergens, possible, basis } = ruled);
    } else if (proposal.allergens.length > 0) {
      // A 组：LLM 确定提议（抽查与第二意见一致——香油/蚝油/豆豉/蟹/板栗/面类等）
      allergens = onlyLegal(proposal.allergens);
      possible = onlyLegal(proposal.suspectedAllergens);
      basis = "LLM 确定提议（抽查一致）";
    } else if (proposal.suspectedAllergens.length > 0) {
      // R7 泛化：仅有不确定意见 → 全部进 possible（失败即关闭）
      allergens = [];
      possible = onlyLegal(proposal.suspectedAllergens);
      basis = "R7 不确定→可能含（配方因品牌而异）";
    } else if (proposal.channel === "review") {
      // B 组：强词表命中但 LLM 认为无过敏原 → 不标，交人工扫
      allergens = [];
      possible = [];
      basis = "B 组默认不标（LLM 判无，待人工扫）";
    } else {
      allergens = [];
      possible = [];
      basis = "batch 默认通过（无过敏原提议）";
    }

    applied.push({
      canonical: proposal.canonical,
      aliases: proposal.aliases,
      existingMatch: proposal.existingMatch,
      suggestedNewId: proposal.suggestedNewId,
      allergens,
      possibleAllergens: possible,
      basis,
      occurrences: proposal.occurrences,
    });
  }

  const readmeTodos = [
    "当前限制一节补充：未注明种类的食用油按不含过敏原处理（高度精炼花生油致敏性很低、压榨油则不然），花生严重过敏者请自行确认用油（R6 取舍）",
  ];
  return { applied, readmeTodos };
}
