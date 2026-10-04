import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String(),
  mealLogId: Type.String({ minLength: 1, description: "get_today_summary 返回的记录 ID" }),
  operationId: Type.Optional(Type.String({ minLength: 1, description: "同一撤销重试时保持不变" } as const)),
});
type ParamsType = Static<typeof Params>;

export const undoMealLogTool: ToolDefinition<typeof Params> = defineTool({
  name: "undo_meal_log",
  label: "撤销饮食记录",
  description: "用户明确要求移除一条误记的饮食记录时调用。先确认目标记录 ID，只能操作当前用户自己的记录；移除后可从饮食记录页面恢复。",
  parameters: Params,
  async execute(
    toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext,
  ) {
    const result = store.undoMealLog(params.userId, params.mealLogId, params.operationId ?? toolCallId);
    return {
      content: [{
        type: "text" as const,
        text: result.undone ? `✅ 已移除误记记录 ${params.mealLogId}，可从饮食记录页面恢复。` : "没有找到这条属于当前用户的记录，未进行更改。",
      }],
      details: { ...result, saved: result.undone },
    };
  },
});
