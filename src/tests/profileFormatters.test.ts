import { describe, it, expect } from "vitest";
import {
  formatUserProfile,
  formatKitchenProfile,
  formatIngredientInventory,
  formatTodaySummary,
  formatWeeklyPlan,
  formatRecipeBook,
} from "../tui/profileFormatters.js";
import type {
  UserProfile,
  KitchenProfile,
  IngredientInventory,
  TodaySummary,
  WeeklyPlan,
  RecipeRecord,
} from "../types/diet.js";

describe("formatUserProfile", () => {
  it("undefined 返回空态引导文案", () => {
    const md = formatUserProfile(undefined);
    expect(md).toMatch(/还没录入/);
    expect(md).toMatch(/减脂/); // 含示例引导
  });

  it("完整画像渲染目标/身高体重/忌口/过敏", () => {
    const p: UserProfile = {
      userId: "u1",
      goal: "fat_loss",
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: "男",
      activityLevel: "medium",
      avoidFoods: ["香菜"],
      allergies: ["花生"],
      preferences: ["清淡"],
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const md = formatUserProfile(p);
    expect(md).toContain("减脂");
    expect(md).toContain("175cm");
    expect(md).toContain("80kg");
    expect(md).toContain("香菜");
    expect(md).toContain("花生");
    expect(md).toContain("清淡");
    expect(md).toContain("2026-08-01");
  });

  it("无 goal 时不渲染目标行", () => {
    const p: UserProfile = { userId: "u1", createdAt: "x", updatedAt: "2026-08-01T00:00:00Z" };
    expect(formatUserProfile(p)).not.toContain("目标");
  });
});

describe("formatKitchenProfile", () => {
  it("渲染炉灶/烤箱/时间预算", () => {
    const k: KitchenProfile = {
      userId: "u1",
      burners: 2,
      hasOven: true,
      cookware: ["炒锅", "汤锅"],
      maxActiveMinutes: 20,
      maxTotalMinutes: 40,
      tastePreferences: ["少辣"],
      cookingPreferences: ["少洗碗"],
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const md = formatKitchenProfile(k);
    expect(md).toContain("2 个");
    expect(md).toContain("炒锅");
    expect(md).toContain("≤ 20 分钟");
    expect(md).toContain("少洗碗");
  });

  it("无烤箱显示「无」", () => {
    const k: KitchenProfile = {
      userId: "u1",
      burners: 1,
      hasOven: false,
      cookware: [],
      maxActiveMinutes: 15,
      maxTotalMinutes: 30,
      tastePreferences: [],
      cookingPreferences: [],
      updatedAt: "x",
    };
    expect(formatKitchenProfile(k)).toContain("烤箱**：无");
  });
});

describe("formatIngredientInventory", () => {
  it("空库存返回空态", () => {
    const inv: IngredientInventory = {
      userId: "u1",
      availableIngredients: [],
      shoppingList: [],
      updatedAt: "x",
    };
    expect(formatIngredientInventory(inv)).toMatch(/厨房还是空的/);
  });

  it("按 category 分组并标注快过期", () => {
    const inv: IngredientInventory = {
      userId: "u1",
      availableIngredients: [
        { name: "鸡胸", category: "protein" },
        { name: "番茄", category: "vegetable", expiresSoon: true, expiresAt: "2026-08-03" },
        { name: "鸡蛋", category: "protein", storage: "fridge" },
      ],
      shoppingList: [{ name: "牛奶", amount: "1L" }],
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const md = formatIngredientInventory(inv);
    expect(md).toContain("蛋白质");
    expect(md).toContain("蔬菜");
    expect(md).toContain("鸡胸");
    expect(md).toContain("⚠️ 快过期");
    expect(md).toContain("2026-08-03");
    expect(md).toContain("购物清单");
    expect(md).toContain("牛奶");
    expect(md).toContain("冰箱");
  });
});

describe("formatTodaySummary", () => {
  it("渲染 summaryText 与热量", () => {
    const t: TodaySummary = {
      userId: "u1",
      date: "2026-08-01",
      meals: [],
      estimatedTotalCalories: 500,
      summaryText: "今日已记录 1 餐，共约 500 千卡。",
    };
    const md = formatTodaySummary(t);
    expect(md).toContain("2026-08-01");
    expect(md).toContain("500");
  });

  it("空 summary 给引导", () => {
    const t: TodaySummary = {
      userId: "u1",
      date: "2026-08-01",
      meals: [],
      estimatedTotalCalories: 0,
      summaryText: "",
    };
    expect(formatTodaySummary(t)).toMatch(/没有饮食记录/);
  });
});

describe("formatWeeklyPlan", () => {
  it("undefined 返回空态", () => {
    expect(formatWeeklyPlan(undefined)).toMatch(/本周还没有菜单/);
  });

  it("逐日渲染主菜/主食/完成标记/缺食材", () => {
    const w: WeeklyPlan = {
      userId: "u1",
      weekStartDate: "2026-07-31",
      status: "active",
      createdAt: "x",
      updatedAt: "x",
      days: [
        {
          dayOfWeek: 1,
          date: "2026-07-31",
          completed: true,
          mainRecipe: {
            id: "r1",
            name: "番茄炒蛋",
            activeMinutes: 8,
            totalMinutes: 15,
            estimatedCalories: 300,
          },
          staplesSuggestion: "米饭",
          reasons: [],
          missingIngredients: ["葱"],
        },
      ],
    };
    const md = formatWeeklyPlan(w);
    expect(md).toContain("周一");
    expect(md).toContain("番茄炒蛋");
    expect(md).toContain("✅");
    expect(md).toContain("米饭");
    expect(md).toContain("葱");
  });
});

describe("formatRecipeBook", () => {
  it("空列表", () => {
    expect(formatRecipeBook([])).toMatch(/菜谱库为空/);
  });

  it("渲染菜名/蛋白/分钟/热量/难度", () => {
    const rs: RecipeRecord[] = [
      {
        id: "r1",
        name: "番茄炒蛋",
        mode: "quick",
        mealTypes: ["dinner"],
        modes: ["quick"],
        suitableGoals: [],
        ingredients: ["番茄"],
        optionalIngredients: [],
        vegetables: ["番茄"],
        staples: [],
        cookware: ["炒锅"],
        appliances: [],
        activeMinutes: 8,
        totalMinutes: 15,
        difficulty: 2,
        dishCount: 2,
        tasteTags: [],
        preferenceTags: [],
        steps: [],
        primaryProtein: "鸡蛋",
        estimatedCalories: 300,
        updatedAt: "x",
      },
    ];
    const md = formatRecipeBook(rs);
    expect(md).toContain("番茄炒蛋");
    expect(md).toContain("鸡蛋");
    expect(md).toContain("8/15分钟");
    expect(md).toContain("300kcal");
    expect(md).toContain("★");
  });
});
