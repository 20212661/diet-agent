/**
 * generate_meal_plan 工具 - 根据用户画像生成简单饮食计划
 */

import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import * as store from "../store/index.js";

const Params = Type.Object({
  userId: Type.String({ description: "用户 ID" }),
  days: Type.Optional(
    Type.Number({ description: "规划天数（1-7），默认 1 天" } as const)
  ),
  target: Type.Optional(
    Type.String({ description: "额外目标描述" } as const)
  ),
});

type ParamsType = Static<typeof Params>;

/** 通用饮食模板（按目标分类） */
const PLAN_TEMPLATES: Record<string, { breakfast: string[]; lunch: string[]; dinner: string[]; snack: string[] }> = {
  fat_loss: {
    breakfast: ["全麦面包 2 片 + 水煮蛋 1 个 + 牛奶 250ml", "燕麦粥 1 碗 + 蓝莓 + 鸡蛋 1 个"],
    lunch: ["鸡胸肉 150g + 糙米饭 1 碗 + 西兰花", "瘦肉 120g + 紫薯 + 蔬菜沙拉"],
    dinner: ["清蒸鱼 150g + 蔬菜 + 少量杂粮饭", "豆腐蔬菜汤 + 玉米半根"],
    snack: ["苹果 1 个", "酸奶 1 杯（低糖）"],
  },
  muscle_gain: {
    breakfast: ["全麦面包 3 片 + 鸡蛋 2 个 + 牛奶 300ml + 香蕉", "燕麦粥 + 蛋白粉 1 勺 + 坚果"],
    lunch: ["鸡胸肉/牛肉 200g + 米饭 1.5 碗 + 西兰花 + 鸡蛋 1 个", "三文鱼 150g + 糙米饭 + 牛油果"],
    dinner: ["虾/鱼 200g + 米饭 1 碗 + 蔬菜 + 牛奶", "鸡胸肉 200g + 意面 + 蔬菜沙拉"],
    snack: ["蛋白棒 1 根", "酸奶 + 坚果 + 香蕉"],
  },
  default: {
    breakfast: ["全麦面包 + 鸡蛋 + 牛奶", "杂粮粥 + 蔬菜包 + 豆浆"],
    lunch: ["荤素搭配 + 粗细粮结合", "鸡/鱼/肉 + 米饭 + 蔬菜"],
    dinner: ["清淡为主 + 蔬菜 + 适量主食", "汤面/粥 + 蔬菜 + 豆制品"],
    snack: ["水果 1 份", "坚果一小把"],
  },
};

function norm(value: string): string {
  return value.toLowerCase().trim();
}

function containsBlockedFood(option: string, blockedFoods: string[]): boolean {
  const normalizedOption = norm(option);
  return blockedFoods.some((food) => {
    const normalizedFood = norm(food);
    return normalizedFood.length > 0 && normalizedOption.includes(normalizedFood);
  });
}

function pickSafeOption(options: string[], blockedFoods: string[]): string {
  const safeOptions = options.filter((option) => !containsBlockedFood(option, blockedFoods));
  if (safeOptions.length === 0) {
    return "暂无符合当前忌口/过敏条件的安全模板，请补充可接受食材";
  }
  return safeOptions[Math.floor(Math.random() * safeOptions.length)];
}

export const generateMealPlanTool: ToolDefinition<typeof Params> = defineTool({
  name: "generate_meal_plan",
  label: "生成饮食计划",
  description:
    "根据用户画像生成简单饮食计划。当用户要求 '明天怎么吃 / 帮我安排减脂餐 / 一周饮食计划' 等时调用。",
  parameters: Params,
  promptGuidelines: [
    "生成饮食计划时，必须避开用户的 avoidFoods 和 allergies。",
    "如果存在 medicalNotes，提醒用户这不是医疗饮食方案。",
  ],
  async execute(
    _toolCallId: string,
    params: ParamsType,
    _signal?: AbortSignal,
    _onUpdate?: unknown,
    _ctx?: ExtensionContext
  ) {
    const { userId, days = 1, target } = params;
    const clampedDays = Math.max(1, Math.min(7, days));

    const profile = store.getUserProfile(userId);
    const goal = profile?.goal ?? "default";
    const template = PLAN_TEMPLATES[goal] ?? PLAN_TEMPLATES.default;

    // 避免/过敏食物
    const avoidSet = new Set([
      ...(profile?.avoidFoods ?? []),
      ...(profile?.allergies ?? []),
    ]);

    const lines: string[] = [];

    if (target) {
      lines.push(`📋 饮食计划（额外目标: ${target}）`);
    } else {
      const goalLabel = goal === "fat_loss" ? "减脂" : goal === "muscle_gain" ? "增肌" : "日常均衡";
      lines.push(`📋 ${goalLabel}饮食计划（${clampedDays} 天）`);
    }

    lines.push("");
    lines.push("⚠️ 以下为参考模板，实际热量为粗略估算。请根据个人情况调整份量。");

    const blockedFoods = [...avoidSet];

    for (let d = 0; d < clampedDays; d++) {
      const dayLabel = clampedDays === 1 ? "今天" : `第 ${d + 1} 天`;
      lines.push(`\n--- ${dayLabel} ---`);

      const b = pickSafeOption(template.breakfast, blockedFoods);
      const l = pickSafeOption(template.lunch, blockedFoods);
      const din = pickSafeOption(template.dinner, blockedFoods);
      const s = pickSafeOption(template.snack, blockedFoods);

      lines.push(`早餐: ${b}`);
      lines.push(`午餐: ${l}`);
      lines.push(`晚餐: ${din}`);
      lines.push(`加餐: ${s}`);
    }

    if (avoidSet.size > 0) {
      lines.push(`\n🚫 已避开: ${[...avoidSet].join("、")}`);
    }

    if (profile?.medicalNotes && profile.medicalNotes.length > 0) {
      lines.push(
        "\n⚠️ 你有健康备注记录。本计划仅为日常参考，不是医疗饮食方案。如有疾病、孕期、用药等情况，请务必咨询医生或专业营养师。"
      );
    }

    lines.push(
      "\n💡 建议：根据实际活动量适当增减，保持饮食多样化，注意饮水和蔬果摄入。"
    );

    const planText = lines.join("\n");
    store.saveMealPlan({
      userId,
      mealType: "daily_plan",
      dishes: [goal === "fat_loss" ? "减脂饮食计划" : goal === "muscle_gain" ? "增肌饮食计划" : "均衡饮食计划"],
      ingredients: [],
      missingIngredients: [],
      activeMinutes: 0,
      totalMinutes: 0,
      fullPlan: planText,
    });

    return {
      content: [{ type: "text" as const, text: planText }],
      details: { userId, days: clampedDays, goal },
    };
  },
});
