import { listEnabledSkills } from "./skillRegistry.js";

export function buildSkillIndexPrompt(): string {
  const skills = listEnabledSkills();

  if (skills.length === 0) {
    return "";
  }

  const lines = skills.map((skill) => {
    return [
      `- ${skill.name}`,
      `  slug: ${skill.slug}`,
      `  category: ${skill.category}`,
      `  description: ${skill.description}`,
      `  triggers: ${skill.triggers.join("、")}`,
    ].join("\n");
  });

  return [
    "## 可用 Skill 索引",
    "",
    "Skill 是可复用工作流程，不是用户长期记忆。",
    "系统只在这里提供 Skill 索引，不提供所有 Skill 全文。",
    "",
    "当用户输入明显匹配某个 Skill 的触发条件时：",
    "1. 优先调用 get_skill 工具加载对应 Skill 全文。",
    "2. 按 Skill 中定义的工具链、判断规则和输出格式执行。",
    "3. 不要只根据 Skill 名称自行发挥。",
    "4. 不要一次加载所有 Skill。",
    "5. 如果多个 Skill 匹配，最多选择最相关的 1-2 个。",
    "6. 如果 Skill 与用户本轮输入冲突，以用户本轮输入为准。",
    "7. 如果 Skill 与安全规则冲突，以安全规则为准。",
    "",
    "### Skill 列表",
    "",
    ...lines,
  ].join("\n");
}
