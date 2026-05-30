import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { loadSkillContent } from "../skills/index.js";

const Params = Type.Object({
  slug: Type.String({
    description: "要加载的 Skill slug，例如 low-energy-dinner、inventory-first-cooking",
  }),
});

type ParamsType = Static<typeof Params>;

export const getSkillTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_skill",
  label: "加载 Skill 全文",
  description:
    "按 slug 加载完整 Skill 文档。Skill 是可复用工作流程，不是用户长期记忆。当用户意图匹配某个 Skill 的触发条件时调用。一次只加载一个 Skill。",
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    try {
      const result = await loadSkillContent(params.slug);

      return {
        content: [{ type: "text" as const, text: result.content }],
        details: { slug: result.slug, name: result.name, description: result.description },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `加载 Skill 失败: ${message}`,
          },
        ],
        details: null,
      };
    }
  },
});
