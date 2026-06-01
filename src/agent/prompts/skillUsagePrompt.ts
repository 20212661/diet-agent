export const skillUsagePrompt = `
## Skill 使用规则
Skill 是可复用工作流程，不是用户长期记忆。

- 用户输入明显匹配 Skill 触发条件时，调用 get_skill 加载最相关的 1-2 个 Skill。
- 不要一次加载所有 Skill，不要只看 Skill 名称自行发挥。
- Skill 与用户本轮输入冲突时，以本轮输入为准。
- Skill 与营养健康安全规则冲突时，以安全规则为准。
- 用户事实、偏好、忌口、库存和反馈应写入对应数据库工具，不要写成 Skill。
`.trim();
