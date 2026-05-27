import "dotenv/config";
import express from "express";
import cors from "cors";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 项目根目录：src/index.ts 的上层
const PROJECT_ROOT = join(__dirname, "..");
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sendDietAgentMessage } from "./agent/createDietAgent.js";
import * as sessionStore from "./agent/sessionStore.js";
import * as store from "./store/index.js";
import { formatErrorResponse } from "./utils/errors.js";
import { installRequestLogger } from "./utils/requestLogger.js";
import { generateCookingPlanTool } from "./tools/generateCookingPlan.js";
import { searchRecipesTool } from "./tools/searchRecipes.js";

installRequestLogger();

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const EMPTY_EXTENSION_CONTEXT = {} as ExtensionContext;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(PROJECT_ROOT, "public")));

function getUserId(req: express.Request): string {
  return requireString(req.params.userId, "userId");
}

function requireString(value: unknown, name: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required and must be a string`);
  }
  return value;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "diet-agent-service" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const userId = requireString(req.body?.userId, "userId");
    const message = requireString(req.body?.message, "message").trim();
    if (!message) throw new Error("message must not be empty");

    const result = await sendDietAgentMessage(userId, message);
    console.log(`[CHAT] userId=${userId}, message="${message.slice(0, 50)}..."`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/chat] error:", err);
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/profile", (req, res) => {
  try {
    const profile = store.getUserProfile(getUserId(req));
    res.json({ ok: true, profile: profile ?? null });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/profile", (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = store.upsertUserProfile(userId, {
      goal: req.body?.goal,
      customGoal: req.body?.customGoal,
      heightCm: req.body?.heightCm,
      weightKg: req.body?.weightKg,
      age: req.body?.age,
      gender: req.body?.gender,
      activityLevel: req.body?.activityLevel,
      avoidFoods: req.body?.avoidFoods,
      preferences: req.body?.preferences,
      allergies: req.body?.allergies,
      medicalNotes: req.body?.medicalNotes,
    });
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/meals/today", (req, res) => {
  try {
    const summary = store.getTodaySummary(getUserId(req));
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/meals", (req, res) => {
  try {
    const foods = Array.isArray(req.body?.foods) ? req.body.foods : [];
    if (foods.length === 0) throw new Error("foods must contain at least one item");
    const meal = store.addMealLog({
      userId: getUserId(req),
      mealType: req.body?.mealType ?? "dinner",
      foods,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
    });
    res.json({ ok: true, meal });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/kitchen", (req, res) => {
  try {
    const kitchen = store.getKitchenProfile(getUserId(req));
    res.json({ ok: true, kitchen });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/kitchen", (req, res) => {
  try {
    const kitchen = store.upsertKitchenProfile(getUserId(req), req.body ?? {});
    res.json({ ok: true, kitchen });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/ingredients", (req, res) => {
  try {
    const inventory = store.getIngredientInventory(getUserId(req));
    res.json({ ok: true, inventory });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/ingredients", (req, res) => {
  try {
    const inventory = store.upsertIngredientInventory(getUserId(req), {
      availableIngredients: req.body?.availableIngredients,
      shoppingList: req.body?.shoppingList,
      replaceAvailable: req.body?.replaceAvailable,
      replaceShoppingList: req.body?.replaceShoppingList,
    });
    res.json({ ok: true, inventory });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.patch("/api/users/:userId/ingredients/status", (req, res) => {
  try {
    const itemName = requireString(req.body?.itemName, "itemName");
    const status = requireString(req.body?.status, "status");
    const item = store.updateIngredientStatus(
      getUserId(req),
      itemName,
      status as Parameters<typeof store.updateIngredientStatus>[2],
      typeof req.body?.note === "string" ? req.body.note : undefined
    );
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/recipes", async (req, res) => {
  try {
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    if (userId) {
      const result = await searchRecipesTool.execute(
        "api-search-recipes",
        {
          userId,
          query: typeof req.query.query === "string" ? req.query.query : undefined,
          timeLimitMinutes: req.query.timeLimitMinutes ? Number(req.query.timeLimitMinutes) : undefined,
          energyLevel: req.query.energyLevel === "low" ? "low" : req.query.energyLevel === "normal" ? "normal" : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        },
        undefined,
        undefined,
        EMPTY_EXTENSION_CONTEXT
      );
      res.json({ ok: true, result });
      return;
    }

    const recipes = store.getRecipeBook();
    res.json({ ok: true, recipes });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/cooking-plan", async (req, res) => {
  try {
    const result = await generateCookingPlanTool.execute(
      "api-cooking-plan",
      {
        userId: getUserId(req),
        availableIngredients: req.body?.availableIngredients,
        shoppingList: req.body?.shoppingList,
        timeLimitMinutes: req.body?.timeLimitMinutes,
        energyLevel: req.body?.energyLevel,
        desiredStyle: req.body?.desiredStyle,
      },
      undefined,
      undefined,
      EMPTY_EXTENSION_CONTEXT
    );
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/cooking-feedback", (req, res) => {
  try {
    const feedback = store.getCookingFeedback(getUserId(req));
    res.json({ ok: true, feedback });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/cooking-feedback", (req, res) => {
  try {
    const feedback = store.addCookingFeedback({
      userId: getUserId(req),
      recipeId: req.body?.recipeId,
      recipeName: req.body?.recipeName,
      rating: req.body?.rating,
      actualActiveMinutes: req.body?.actualActiveMinutes,
      actualTotalMinutes: req.body?.actualTotalMinutes,
      tooTiring: req.body?.tooTiring,
      tooManyDishes: req.body?.tooManyDishes,
      wouldCookAgain: req.body?.wouldCookAgain,
      note: req.body?.note,
    });
    res.json({ ok: true, feedback });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/api/users/:userId/workflow/today", (req, res) => {
  try {
    const userId = getUserId(req);
    const kitchen = store.getKitchenProfile(userId);
    const inventory = store.getIngredientInventory(userId);
    const today = store.getTodaySummary(userId);
    const feedback = store.getCookingFeedback(userId).slice(0, 5);
    const available = inventory.availableIngredients.filter((item) => !item.status || item.status === "available");
    const expiring = available.filter((item) => item.expiresSoon);
    const shopping = inventory.shoppingList.filter((item) => !item.status || item.status === "planned" || item.status === "available");

    res.json({
      ok: true,
      workflow: {
        userId,
        kitchen,
        inventory,
        today,
        recentFeedback: feedback,
        metrics: {
          availableCount: available.length,
          shoppingCount: shopping.length,
          expiringCount: expiring.length,
          mealsLoggedToday: today.meals.length,
        },
        nextActions: buildWorkflowActions(available.length, shopping.length, today.meals.length),
      },
    });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/workflow/shopping-plan", async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await searchRecipesTool.execute(
      "api-workflow-shopping-plan",
      {
        userId,
        query: typeof req.body?.desiredStyle === "string" ? req.body.desiredStyle : "晚饭 快手",
        timeLimitMinutes: req.body?.timeLimitMinutes ? Number(req.body.timeLimitMinutes) : 20,
        energyLevel: req.body?.energyLevel === "low" ? "low" : "normal",
        limit: 5,
      },
      undefined,
      undefined,
      EMPTY_EXTENSION_CONTEXT
    );

    const matches = ((result as any).details?.matches ?? []) as Array<{
      recipe: { name: string; activeMinutes: number; totalMinutes: number };
      missingIngredients: string[];
      reasons: string[];
      score: number;
    }>;
    const shoppingItems = [...new Set(matches.flatMap((match) => match.missingIngredients))]
      .slice(0, 12)
      .map((name) => ({ name, status: "planned" as const }));

    if (shoppingItems.length > 0 && req.body?.save !== false) {
      store.upsertIngredientInventory(userId, { shoppingList: shoppingItems, replaceShoppingList: false });
    }

    res.json({
      ok: true,
      shoppingItems,
      candidates: matches.map((match) => ({
        name: match.recipe.name,
        score: match.score,
        activeMinutes: match.recipe.activeMinutes,
        totalMinutes: match.recipe.totalMinutes,
        missingIngredients: match.missingIngredients,
        reasons: match.reasons,
      })),
      result,
    });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.post("/api/users/:userId/workflow/weekend-prep", (req, res) => {
  try {
    const userId = getUserId(req);
    const inventory = store.getIngredientInventory(userId);
    const availableNames = new Set(
      inventory.availableIngredients
        .filter((item) => !item.status || item.status === "available")
        .map((item) => item.name)
    );
    const recipes = store.getRecipeBook()
      .filter((recipe) => recipe.weekendPrep || recipe.freezerReuse || recipe.modes.includes("prep"))
      .slice(0, 8);
    const tasks = recipes.map((recipe) => ({
      recipeId: recipe.id,
      recipeName: recipe.name,
      activeMinutes: recipe.activeMinutes,
      weekendPrep: recipe.weekendPrep ?? "提前清洗、切配并分装主食或蛋白质。",
      freezerReuse: recipe.freezerReuse,
      matchedIngredients: recipe.ingredients.filter((name) => availableNames.has(name)),
      missingIngredients: recipe.ingredients.filter((name) => !availableNames.has(name)).slice(0, 4),
    }));

    res.json({ ok: true, tasks });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.delete("/api/users/:userId", (req, res) => {
  try {
    const userId = getUserId(req);
    store.clearUserData(userId);
    sessionStore.deleteSession(userId);
    res.json({ ok: true, message: `User ${userId} data cleared` });
  } catch (err) {
    res.status(500).json(formatErrorResponse(err));
  }
});

app.get("/", (_req, res) => {
  res.sendFile(join(PROJECT_ROOT, "public", "index.html"));
});

function buildWorkflowActions(availableCount: number, shoppingCount: number, mealsLoggedToday: number): string[] {
  const actions: string[] = [];
  if (shoppingCount === 0) actions.push("4 点前生成购物清单");
  if (availableCount === 0) actions.push("回家后先录入买到的食材");
  if (availableCount > 0) actions.push("做饭前生成 15-20 分钟晚饭计划");
  if (mealsLoggedToday === 0) actions.push("吃完后记录晚餐和做饭反馈");
  actions.push("周末根据反馈做一次备菜");
  return actions;
}

app.listen(PORT, () => {
  console.log(`Diet Agent Service started: http://localhost:${PORT}`);
});
