import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { repairToolArguments, wrapToolsForUser } from "../agent/modelAdapter.js";
import {
  classifyArgumentRepairs,
  discardToolRepairRecording,
  isStructuralJsonArgs,
  startToolRepairRecording,
  stopToolRepairRecording,
} from "../agent/toolRepairTelemetry.js";
import { setActiveUserMessage } from "../utils/userTurnContext.js";

afterEach(() => {
  discardToolRepairRecording();
  delete process.env.DIET_TOOL_REPAIR;
});

describe("DIET_TOOL_REPAIR 开关", () => {
  it("off 时跳过类型修复，但 userId/operationId 注入保留", () => {
    process.env.DIET_TOOL_REPAIR = "off";
    const clear = setActiveUserMessage("u1", "记录午餐", "op-1");
    try {
      const repaired = repairToolArguments("log_meal", { foods: "米饭,鸡蛋", replaceAvailable: "是" }, "u1");
      expect(repaired.foods).toBe("米饭,鸡蛋");
      expect(repaired.replaceAvailable).toBe("是");
      expect(repaired.userId).toBe("u1");
      expect(repaired.operationId).toMatch(/^op-1:log_meal:/);
    } finally {
      clear();
    }
  });

  it("默认（on）时类型修复照常生效", () => {
    const repaired = repairToolArguments(
      "generate_meal_plan",
      { availableIngredients: "土豆, 鸡腿", days: "3", replaceAvailable: "是" },
      "u1",
    );
    expect(repaired.availableIngredients).toEqual(["土豆", "鸡腿"]);
    expect(repaired.days).toBe(3);
    expect(repaired.replaceAvailable).toBe(true);
  });
});

describe("classifyArgumentRepairs / isStructuralJsonArgs", () => {
  it("按类型识别数组/布尔/数字问题，含嵌套对象字段", () => {
    const categories = classifyArgumentRepairs(
      { availableIngredients: "土豆,鸡腿", replaceAvailable: "是", days: "3", energyOverrides: [{ dayOfWeek: "2" }] },
      { availableIngredients: ["土豆", "鸡腿"], replaceAvailable: true, days: 3, energyOverrides: [{ dayOfWeek: 2 }] },
    );
    expect(new Set(categories)).toEqual(new Set(["array_as_string", "boolean_as_text", "number_as_string"]));
  });

  it("无差异时返回空数组", () => {
    expect(classifyArgumentRepairs({ foods: [{ name: "米饭" }] }, { foods: [{ name: "米饭" }] })).toEqual([]);
  });

  it("识别整体字符串/包装结构参数", () => {
    expect(isStructuralJsonArgs('{"foods":[]}')).toBe(true);
    expect(isStructuralJsonArgs({ input: { foods: [] } })).toBe(true);
    expect(isStructuralJsonArgs({ arguments: "{}" })).toBe(true);
    expect(isStructuralJsonArgs({ foods: [] })).toBe(false);
  });
});

describe("评测遥测（wrapToolsForUser 钩子）", () => {
  it("记录问题占比与分类；缺字段按 schema.required 检测并排除身份字段", () => {
    startToolRepairRecording();
    const tool = wrapToolsForUser("u1", [{
      name: "log_meal",
      label: "记录饮食",
      description: "d",
      parameters: Type.Object({
        userId: Type.String(),
        foods: Type.Array(Type.Object({ name: Type.String(), amount: Type.String() })),
        note: Type.Optional(Type.String()),
      }),
      execute: vi.fn(async () => ({ content: [], details: {} })),
    }])[0];

    const malformed = tool.prepareArguments?.({ foods: "米饭,鸡蛋" }) as Record<string, unknown>;
    expect(malformed.foods).toEqual([
      { name: "米饭", amount: "未注明" },
      { name: "鸡蛋", amount: "未注明" },
    ]);
    // 缺 foods（schema 必填）：不修复、只计数
    const missing = tool.prepareArguments?.({}) as Record<string, unknown>;
    expect(missing.foods).toBeUndefined();
    // 干净调用：不计问题
    tool.prepareArguments?.({ foods: [{ name: "米饭", amount: "1碗" }] });

    const summary = stopToolRepairRecording();
    expect(summary).toMatchObject({ toolCalls: 3, callsWithIssues: 2, issueRate: 0.667 });
    expect(summary?.byCategory).toMatchObject({ array_as_string: 1, missing_field: 1 });
    expect(summary?.byCategory).not.toHaveProperty("json_string_args");
  });

  it("未启用记录时 prepareArguments 正常且无统计", () => {
    const tool = wrapToolsForUser("u2", [{
      name: "log_meal",
      label: "记录饮食",
      description: "d",
      parameters: Type.Object({ userId: Type.String(), foods: Type.Array(Type.Any()) }),
      execute: vi.fn(async () => ({ content: [], details: {} })),
    }])[0];
    expect((tool.prepareArguments?.({ foods: "米饭" }) as Record<string, unknown>).foods).toEqual([{ name: "米饭", amount: "未注明" }]);
    expect(stopToolRepairRecording()).toBeUndefined();
  });
});
