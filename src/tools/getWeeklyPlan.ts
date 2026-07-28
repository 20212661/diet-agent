import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";
import type { WeeklyPlan } from "../types/diet.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  weekStartDate: Type.Optional(
    Type.String({ description: "周一日期 (YYYY-MM-DD)，默认本周" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const getWeeklyPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "get_weekly_plan",
  label: "查看一周菜单",
  description:
    "查看当前（或指定）一周的已保存菜单。用户问'这周吃什么 / 一周菜单 / 今天该做什么'时调用。返回每天的菜谱、完成状态和缺少食材。",
  parameters: Params,
  promptGuidelines: [
    "如果没有已保存的一周菜单，告诉用户可以用 generate_weekly_plan 生成。",
    "已完成的日期用对勾标记。",
  ],
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const plan = store.getWeeklyPlan(params.userId, params.weekStartDate);

    if (!plan || plan.days.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "还没有生成这周的菜单。可以说\"帮我安排这周吃什么\"来生成。",
          },
        ],
        details: { userId: params.userId, found: false } as { userId: string; found: boolean; plan?: WeeklyPlan },
      };
    }

    const lines: string[] = [];
    lines.push(`## 一周菜单（${plan.weekStartDate} 起）`);
    lines.push("");

    const completedCount = plan.days.filter((d) => d.completed).length;
    lines.push(`进度：${completedCount}/${plan.days.length} 天已完成`);
    lines.push("");

    for (const day of plan.days) {
      const label = DAY_LABELS[day.dayOfWeek] ?? `周${day.dayOfWeek}`;
      const check = day.completed ? "已完成" : "未做";
      const sideText = day.sideRecipe ? ` + ${day.sideRecipe.name}` : "";
      lines.push(`- ${label} (${day.date}) [${check}]：${day.mainRecipe.name}${sideText}，主食：${day.staplesSuggestion}`);
      if (day.missingIngredients.length > 0) {
        lines.push(`  缺少食材：${day.missingIngredients.join("、")}`);
      }
    }

    const allMissing = [...new Set(plan.days.flatMap((d) => d.missingIngredients))];
    if (allMissing.length > 0) {
      lines.push("");
      lines.push("### 需要购买的食材汇总");
      lines.push(allMissing.join("、"));
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { userId: params.userId, found: true, plan },
    };
  },
});
