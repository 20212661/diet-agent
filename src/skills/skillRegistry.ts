export type SkillCategory = "cooking" | "diet" | "memory" | "feedback" | "planning";

export type SkillMeta = {
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  category: SkillCategory;
  relativePath: string;
  enabled: boolean;
};

export const BUILTIN_SKILLS: SkillMeta[] = [
  {
    slug: "low-energy-dinner",
    name: "低能量晚饭规划",
    description:
      "当用户很累、没力气、不想洗碗、不想复杂做饭时，用于生成低压力晚饭方案。",
    triggers: ["累", "很累", "没力气", "随便吃点", "简单点", "不想洗碗", "不想做饭", "别麻烦"],
    category: "cooking",
    relativePath: "skills/low-energy-dinner/SKILL.md",
    enabled: true,
  },
  {
    slug: "inventory-first-cooking",
    name: "库存优先做饭规划",
    description:
      "当用户要求今晚吃什么、冰箱有什么能做、优先处理快过期食材时使用。",
    triggers: ["今晚吃什么", "冰箱", "库存", "快过期", "有什么能做", "用掉", "还剩"],
    category: "cooking",
    relativePath: "skills/inventory-first-cooking/SKILL.md",
    enabled: true,
  },
  {
    slug: "cooking-feedback-learning",
    name: "做饭反馈沉淀",
    description:
      "当用户评价菜谱、耗时、口味、洗碗量、是否下次推荐时使用。",
    triggers: ["太累", "太麻烦", "好吃", "下次别推荐", "太咸", "太淡", "洗碗太多", "适合工作日"],
    category: "feedback",
    relativePath: "skills/cooking-feedback-learning/SKILL.md",
    enabled: true,
  },
  {
    slug: "calorie-calibration",
    name: "热量校准估算",
    description:
      "当用户询问菜品热量、要求按自己的版本估算、或存在热量校准记录时使用。",
    triggers: ["多少热量", "卡路里", "kcal", "估算热量", "按我的版本", "热量校准"],
    category: "diet",
    relativePath: "skills/calorie-calibration/SKILL.md",
    enabled: true,
  },
];

export function getSkillMetaBySlug(slug: string): SkillMeta | undefined {
  return BUILTIN_SKILLS.find((skill) => skill.enabled && skill.slug === slug);
}

export function listEnabledSkills(): SkillMeta[] {
  return BUILTIN_SKILLS.filter((skill) => skill.enabled);
}
