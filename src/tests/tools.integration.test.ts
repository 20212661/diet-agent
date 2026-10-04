import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setActiveUserMessage } from "../utils/userTurnContext.js";

process.env.DIET_AGENT_DB_PATH = ":memory:";

const store = await import("../store/index.js");
const { updateUserProfileTool } = await import("../tools/updateUserProfile.js");
const { getUserProfileTool } = await import("../tools/getUserProfile.js");
const { updateKitchenProfileTool } = await import("../tools/updateKitchenProfile.js");
const { getKitchenProfileTool } = await import("../tools/getKitchenProfile.js");
const { updateIngredientInventoryTool } = await import("../tools/updateIngredientInventory.js");
const { getIngredientInventoryTool } = await import("../tools/getIngredientInventory.js");
const { markIngredientUsedTool } = await import("../tools/markIngredientUsed.js");
const { logCookingFeedbackTool } = await import("../tools/logCookingFeedback.js");
const { generateMealPlanTool } = await import("../tools/generateMealPlan.js");
const { logMealTool } = await import("../tools/logMeal.js");
const { editMealLogTool } = await import("../tools/editMealLog.js");
const { undoMealLogTool } = await import("../tools/undoMealLog.js");
const { getWeeklyPlanTool } = await import("../tools/getWeeklyPlan.js");
const { getTodaySummaryTool } = await import("../tools/getTodaySummary.js");
const { assessFoodSafety } = await import("../recipes/foodSafety.js");
const { matchRecipes } = await import("../recipes/recipeMatcher.js");

const context = { hasUI: true, ui: { confirm: async () => true } } as unknown as ExtensionContext;
const user = (prefix: string) => `${prefix}_${randomUUID()}`;
const textOf = (result: Awaited<ReturnType<any>>): string => {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
};
const execute = (tool: any, params: Record<string, unknown>) =>
  tool.execute(randomUUID(), params, undefined, undefined, context);

describe("画像与厨房工具集成", () => {
  it("空画像返回引导，更新后仅当前用户可见并显示健康提醒", async () => {
    const firstUser = user("profile");
    const otherUser = user("profile_other");
    expect(textOf(await execute(getUserProfileTool, { userId: firstUser }))).toContain("暂无");

    const updated = await execute(updateUserProfileTool, {
      userId: firstUser,
      goal: "fat_loss",
      allergies: ["花生"],
      medicalNotes: ["高血压"],
    });
    expect(textOf(updated)).toContain("咨询专业医生");
    expect(textOf(await execute(getUserProfileTool, { userId: firstUser }))).toContain("花生");
    expect((await execute(getUserProfileTool, { userId: otherUser })).details).toBeNull();
  });

  it("画像变更先展示待保存字段；拒绝确认或无确认界面时不写入", async () => {
    const userId = user("profile_confirm");
    const confirm = vi.fn(async () => false);
    const declinedContext = { hasUI: true, ui: { confirm } } as unknown as ExtensionContext;
    const declined = await updateUserProfileTool.execute(randomUUID(), {
      userId, allergies: ["虾"], avoidFoods: ["香菜"],
    }, undefined, undefined, declinedContext);
    expect(confirm).toHaveBeenCalledWith("确认保存饮食画像", expect.stringContaining("长期过敏信息：虾"));
    expect(declined.details).toMatchObject({ saved: false, cancelled: true });
    expect(store.getUserProfile(userId)).toBeUndefined();

    const noUi = await updateUserProfileTool.execute(randomUUID(), { userId, allergies: ["虾"] }, undefined, undefined, {} as ExtensionContext);
    expect(noUi.details).toMatchObject({ saved: false, confirmationRequired: true });
    expect(store.getUserProfile(userId)).toBeUndefined();
  });

  it("当前轮临时忌口不会进入长期画像，即使工具参数误带过敏字段", async () => {
    const userId = user("temporary_avoidance");
    const clear = setActiveUserMessage(userId, "这周别安排虾");
    try {
      const result = await updateUserProfileTool.execute(randomUUID(), {
        userId, allergies: ["虾"], avoidFoods: ["虾"],
      }, undefined, undefined, context);
      expect(result.details).toMatchObject({ saved: false, temporaryAvoidance: true });
      expect(store.getUserProfile(userId)).toBeUndefined();
    } finally {
      clear();
    }
    const longTermTurn = setActiveUserMessage(userId, "我对虾过敏，以后推荐要长期避开");
    try {
      const result = await updateUserProfileTool.execute(randomUUID(), {
        userId, allergies: ["虾"],
      }, undefined, undefined, context);
      expect(result.details).toMatchObject({ saved: true, allergies: ["虾"] });
      expect(store.getUserProfile(userId)?.allergies).toEqual(["虾"]);
    } finally {
      longTermTurn();
    }
  });

  it("厨房设备完整写入并读取", async () => {
    const userId = user("kitchen");
    await execute(updateKitchenProfileTool, {
      userId, burners: 1, hasOven: false, hasMicrowave: true, hasRiceCooker: true,
      cookware: ["汤锅"], maxActiveMinutes: 10, maxTotalMinutes: 20,
    });
    const result = await execute(getKitchenProfileTool, { userId });
    expect(textOf(result)).toContain("微波炉：有");
    expect(textOf(result)).toContain("电饭煲：有");
    expect(result.details).toMatchObject({ userId, burners: 1, hasOven: false });
  });
});

describe("库存与反馈工具集成", () => {
  it("整表库存保存拒绝过期版本，保留期间新增的食材", () => {
    const userId = user("inventory_conflict");
    const initial = store.upsertIngredientInventory(userId, { availableIngredients: ["番茄"] });
    store.upsertIngredientInventory(userId, { availableIngredients: ["鸡蛋"] });
    const stale = store.replaceIngredientInventoryIfCurrent(userId, initial.updatedAt, [{ name: "番茄" }], []);
    expect(stale.status).toBe("conflict");
    expect(store.getIngredientInventory(userId).availableIngredients.map((item) => item.name)).toEqual(["番茄", "鸡蛋"]);
    const current = store.getIngredientInventory(userId);
    const saved = store.replaceIngredientInventoryIfCurrent(userId, current.updatedAt, [{ name: "西兰花" }], []);
    expect(saved.status).toBe("updated");
    expect(store.getIngredientInventory(userId).availableIngredients.map((item) => item.name)).toEqual(["西兰花"]);
  });

  it("结构化库存去重、快过期过滤和状态更新", async () => {
    const userId = user("inventory");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await execute(updateIngredientInventoryTool, {
      userId,
      availableItems: [
        { name: "鸡蛋", amount: "2个", storage: "fridge", category: "protein", expiresAt: tomorrow },
        { name: "鸡蛋", amount: "4个", storage: "fridge", category: "protein", expiresAt: tomorrow },
      ],
      replaceAvailable: true,
    });
    const expiring = await execute(getIngredientInventoryTool, { userId, filter: "expiring_soon" });
    expect(textOf(expiring)).toContain("鸡蛋");
    expect(expiring.details.availableIngredients).toHaveLength(1);
    expect(expiring.details.availableIngredients[0].amount).toBe("4个");

    const marked = await execute(markIngredientUsedTool, {
      userId, ingredientName: "鸡蛋", status: "used", note: "早餐",
    });
    expect(textOf(marked)).toContain("已用");
    expect(store.getIngredientInventory(userId).availableIngredients[0].status).toBe("used");
    expect(textOf(await execute(markIngredientUsedTool, {
      userId, ingredientName: "不存在", status: "used",
    }))).toContain("未找到");
  });

  it("反馈的 false 布尔值和记录身份保持不变", async () => {
    const userId = user("feedback");
    const result = await execute(logCookingFeedbackTool, {
      userId, recipeName: "番茄炒蛋", rating: 2, tooTiring: true,
      tooManyDishes: false, wouldCookAgain: false, note: "偏咸",
    });
    expect(textOf(result)).toContain("下次是否推荐：否");
    expect(store.getCookingFeedback(userId)[0]).toMatchObject({
      userId, rating: 2, tooTiring: true, tooManyDishes: false, wouldCookAgain: false,
    });
  });
});

describe("计划与汇总工具集成", () => {
  it("饮食计划限制为 1-7 天并真正排除过敏菜谱", async () => {
    const userId = user("meal_plan");
    store.upsertUserProfile(userId, { goal: "muscle_gain", allergies: ["鱼", "虾"] });
    const result = await execute(generateMealPlanTool, { userId, days: 99 });
    expect(result.details.days).toHaveLength(7);
    expect(textOf(result)).toContain("已按已知食材信息筛选: 鱼、虾");
    for (const day of result.details.days) {
      for (const planned of day.meals) {
        expect(assessFoodSafety(planned.ingredients, { allergies: ["鱼", "虾"] }).status).toBe("clear");
      }
    }
  });

  it("周计划空数据、保存数据及完成状态分支", async () => {
    const userId = user("weekly_get");
    const kitchen = store.getKitchenProfile(userId);
    const recipe = store.getRecipeBook().find((item) => item.ingredients.includes("青菜") && matchRecipes({
      recipes: [item], availableIngredients: [], shoppingList: [], kitchenProfile: kitchen,
      userProfile: store.getUserProfile(userId), feedback: [], timeLimitMinutes: kitchen.maxActiveMinutes,
    }).length > 0);
    expect(recipe).toBeTruthy();
    expect(textOf(await execute(getWeeklyPlanTool, {
      userId, weekStartDate: "2026-09-21",
    }))).toContain("还没有生成");
    store.upsertWeeklyPlan(userId, "2026-09-21", [{
      dayOfWeek: 1,
      // Use the same local-calendar date as the store; UTC can still be yesterday in Asia/Shanghai.
      date: store.getTodaySummary(userId).date,
      mainRecipe: { id: recipe!.id, name: recipe!.name, activeMinutes: recipe!.activeMinutes, totalMinutes: recipe!.totalMinutes },
      staplesSuggestion: "米饭",
      reasons: [],
      missingIngredients: ["青菜"],
      completed: false,
    }]);
    store.addMealLog({ userId, mealType: "dinner", foods: [{ name: recipe!.name, amount: "1份" }] });
    const result = await execute(getWeeklyPlanTool, { userId, weekStartDate: "2026-09-21" });
    expect(textOf(result)).toContain("0/1 天已完成");
    expect(result.details.plan.days[0]).toMatchObject({ completed: false, hasDinnerLog: true });
    expect(textOf(result)).toContain("青菜");
    expect(textOf(result)).toMatch(/待加入采购清单：.*青菜/);
  });

  it("今日总结不把缺少来源的旧热量当作可追溯数据", async () => {
    const userId = user("summary");
    expect(textOf(await execute(getTodaySummaryTool, { userId }))).toContain("暂无饮食记录");
    store.addMealLog({
      userId, mealType: "lunch", foods: [{ name: "米饭", amount: "1碗", estimatedCalories: 300 }],
    });
    const result = await execute(getTodaySummaryTool, { userId });
    expect(result.details.estimatedTotalCalories).toBeUndefined();
    expect(textOf(result)).toContain("热量合计未显示");
  });

  it("份量不清时不写入；相同操作 ID 重试只落一条记录", async () => {
    const userId = user("meal_idempotent");
    const unclear = await execute(logMealTool, {
      userId, mealType: "lunch", foods: [{ name: "米饭", amount: "未注明" }],
    });
    expect(unclear.details).toMatchObject({ saved: false, clarificationRequired: true });
    expect(store.getAllMealLogs(userId)).toHaveLength(0);

    const params = {
      userId, operationId: "same-log-operation", date: "2026-09-22", mealType: "lunch",
      foods: [{ name: "米饭", amount: "1碗" }],
    };
    const first = await execute(logMealTool, params);
    const retry = await execute(logMealTool, params);
    expect(first.details.id).toBe(retry.details.id);
    expect(store.getAllMealLogs(userId)).toHaveLength(1);
    expect(store.getAllMealLogs(userId)[0]?.date).toBe("2026-09-22");
    await expect(execute(logMealTool, { ...params, foods: [{ name: "面条", amount: "1碗" }] }))
      .rejects.toThrow("operationId");
  });

  it("餐食日期指向相对日期或未说明时先追问，不生成日期", async () => {
    const userId = user("meal_date_clarify");
    const clear = setActiveUserMessage(userId, "前天吃了一碗米饭，帮我记一下");
    try {
      const result = await execute(logMealTool, {
        userId, mealType: "lunch", foods: [{ name: "米饭", amount: "1碗" }],
      });
      expect(result.details).toMatchObject({ saved: false, clarificationRequired: true });
      expect(store.getAllMealLogs(userId)).toHaveLength(0);
    } finally {
      clear();
    }
  });

  it("可按记录 ID 更正和撤销餐食；操作重试安全且用户隔离", async () => {
    const userId = user("meal_edit");
    const otherUserId = user("meal_edit_other");
    const logged = await execute(logMealTool, {
      userId, operationId: "edit-seed", mealType: "lunch", foods: [{ name: "米饭", amount: "1碗" }],
    });
    const mealLogId = logged.details.id as string;
    const editParams = {
      userId, mealLogId, operationId: "edit-operation", date: "2026-09-21",
      foods: [{ name: "米饭", amount: "半碗" }],
    };
    const edited = await execute(editMealLogTool, editParams);
    const retriedEdit = await execute(editMealLogTool, editParams);
    expect(edited.details).toMatchObject({ date: "2026-09-21", foods: [{ amount: "半碗" }] });
    expect(retriedEdit.details).toMatchObject({ date: "2026-09-21", foods: [{ amount: "半碗" }] });
    await expect(execute(editMealLogTool, { ...editParams, foods: [{ name: "米饭", amount: "2碗" }] }))
      .rejects.toThrow("operationId");
    expect((await execute(undoMealLogTool, { userId: otherUserId, mealLogId, operationId: "wrong-user-undo" })).details)
      .toMatchObject({ undone: false });
    expect((await execute(undoMealLogTool, { userId, mealLogId, operationId: "undo-operation" })).details)
      .toMatchObject({ undone: true });
    expect((await execute(undoMealLogTool, { userId, mealLogId, operationId: "undo-operation" })).details)
      .toMatchObject({ undone: true });
    expect(store.getAllMealLogs(userId)).toHaveLength(0);
    expect(store.getDeletedMealLogsByDate(userId, "2026-09-21")).toHaveLength(1);
    expect(store.getTodaySummary(userId, "2026-09-21").meals).toHaveLength(0);
    expect(store.restoreMealLog(userId, mealLogId, "restore-operation")).toMatchObject({ restored: true });
    expect(store.getMealLogsByDate(userId, "2026-09-21")).toHaveLength(1);
    expect(store.getDeletedMealLogsByDate(userId, "2026-09-21")).toHaveLength(0);
  });
});

describe("可靠 ID", () => {
  it("并发式批量写入不会产生 ID 碰撞", () => {
    const userId = user("ids");
    const ids = Array.from({ length: 250 }, () => store.addMealLog({
      userId, mealType: "snack", foods: [{ name: "坚果", amount: "1份" }],
    }).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^meal_[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});
