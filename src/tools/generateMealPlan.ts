/** Build a deterministic one-to-seven-day meal plan from the recipe book and pantry. */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { buildAndSaveMealPlan } from "../services/mealPlanBuilder.js";
const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  days: Type.Optional(Type.Number({ minimum: 1, maximum: 7, description: "规划天数（1-7），默认 1 天" } as const)),
  startDate: Type.Optional(Type.String({ description: "计划开始日期 YYYY-MM-DD，默认今天" } as const)),
  target: Type.Optional(Type.String({ maxLength: 500, description: "饮食目标或补充说明，例如减脂、增肌、清淡" } as const)),
  timeLimitMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 240, description: "每餐主动操作时间上限；指定后超时菜谱不入选" } as const)),
  energyLevel: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("normal")], { description: "当前精力状态" } as const)),
  preferredStyles: Type.Optional(Type.Array(Type.String(), { description: "本次计划偏好，如清淡、少油烟、少洗碗；不会写入长期画像" } as const)),
  temporaryAvoidFoods: Type.Optional(Type.Array(Type.String(), { description: "仅本次计划生效的临时忌口；不会写入长期画像" } as const)),
});

type ParamsType = Static<typeof Params>;
export const generateMealPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "generate_meal_plan",
  label: "生成饮食计划",
  description: "根据画像、过敏忌口、库存、菜谱、厨房条件、目标和时间限制生成并保存 1-7 天饮食计划。用户要求安排今天/几天饮食、减脂餐、增肌餐时调用。",
  parameters: Params,
  promptGuidelines: [
    "本工具会读取已保存的画像、库存、厨房条件和做饭反馈；除非需要澄清或补充数据，不必先重复调用查询工具。",
    "把用户当次表达的目标、口味、时间和精力传入 target、preferredStyles、timeLimitMinutes、energyLevel。",
    "本次临时不吃的食物放入 temporaryAvoidFoods；不要为了临时忌口修改长期画像。",
    "过敏与忌口是硬约束；不要推荐需要核实的食材组合。",
    "指定了 timeLimitMinutes 时，只能选择主动操作时间不超过限制的菜谱或模板；没有候选就明确说明。",
    "如果存在 medicalNotes，提醒用户该计划不是医疗饮食方案。",
  ],
  async execute(_toolCallId: string, params: ParamsType, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: ExtensionContext) {
    return buildAndSaveMealPlan(params);
  },
});
