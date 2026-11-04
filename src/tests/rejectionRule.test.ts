/**
 * 否决捕获规则层（确定性，CI 不联网）：10 段场景的规则臂预期 + 邻接负例 + 推荐集消耗。
 */
import { describe, expect, it } from "vitest";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { REJECTION_SCENARIOS } = await import("../eval/rejectionScenarios.js");
const {
  captureRuleRejections,
  ensureMealPlanTask,
  getInjectableTask,
  noteSuggestedRecipes,
} = await import("../tasks/taskStateService.js");

function setup(userId: string, suggestedNames: readonly string[]): void {
  store.clearUserData(userId);
  ensureMealPlanTask(userId);
  const book = store.getRecipeBook();
  noteSuggestedRecipes(userId, suggestedNames
    .map((name) => book.find((recipe) => recipe.name === name)?.id)
    .filter((id): id is string => id !== undefined));
}

describe("否决捕获：规则层（确定性）", () => {
  it("R1-R6 点名否决全部捕获；F7/F8 特征否决规则层不捕（交给 LLM）；N9/N10 不误捕", () => {
    for (const scenario of REJECTION_SCENARIOS) {
      const userId = `rule_${scenario.id}`;
      setup(userId, scenario.suggestedNames);
      const captured = captureRuleRejections(userId, scenario.message).map((item) => item.name);
      if (scenario.id.startsWith("R")) {
        expect(captured, `${scenario.id} 应规则捕获`).toEqual(scenario.expectedRejected);
      } else {
        // F=特征否决（LLM 责任）、N=易误捕段：规则层都不应捕获
        expect(captured, `${scenario.id} 规则层不应捕获`).toEqual([]);
      }
    }
  });

  it("邻接负例：『白灼虾不要放辣』的不要指向辣不是菜——不否决；『不要白灼虾』才否决", () => {
    const userId = "rule_adjacent";
    setup(userId, ["白灼虾"]);
    expect(captureRuleRejections(userId, "白灼虾不要放辣，别的都行")).toEqual([]);
    expect(captureRuleRejections(userId, "不要白灼虾了").map((item) => item.name)).toEqual(["白灼虾"]);
  });

  it("捕获后从推荐集移除，下一轮不再重复触发；推荐集为空时零开销返回", () => {
    const userId = "rule_consume";
    setup(userId, ["白灼虾", "番茄炒蛋"]);
    expect(captureRuleRejections(userId, "白灼虾换掉").map((item) => item.name)).toEqual(["白灼虾"]);
    const task = getInjectableTask(userId)!;
    expect(task.artifactIds.suggestedRecipeIds).toHaveLength(1); // 只剩番茄炒蛋
    expect(captureRuleRejections(userId, "白灼虾换掉再说一遍")).toEqual([]); // 已移出推荐集
    expect(getInjectableTask(userId)!.rejected.map((item) => item.name)).toEqual(["白灼虾"]);
  });

  it("无任务时规则层静默跳过", () => {
    expect(captureRuleRejections("rule_nobody", "白灼虾换掉")).toEqual([]);
  });
});
