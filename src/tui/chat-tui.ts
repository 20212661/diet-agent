/**
 * 饮食管理智能体 - 终端 TUI 聊天界面
 * 基于 @earendil-works/pi-tui
 * 直接 import agent 模块，不走 HTTP
 */

import {
  TUI,
  Text,
  Input,
  Markdown,
  Loader,
  Box,
  ProcessTerminal,
  matchesKey,
  type Component,
} from "@earendil-works/pi-tui";

import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { sendDietAgentMessage } from "../agent/createDietAgent.js";
import { startSetupCommand } from "./onboarding.js";
import * as store from "../store/index.js";
import type { MealType } from "../types/diet.js";

// ─── ANSI 颜色辅助 ──────────────────────────────────
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Markdown 主题 ──────────────────────────────────
const chatMarkdownTheme = {
  heading: (t: string) => bold(cyan(t)),
  link: (t: string) => cyan(t),
  linkUrl: (t: string) => gray(t),
  code: (t: string) => yellow(t),
  codeBlock: (t: string) => `\x1b[48;5;236m${t}\x1b[0m`,
  codeBlockBorder: (t: string) => gray(t),
  quote: (t: string) => `\x1b[32m${t}\x1b[0m`,
  quoteBorder: (t: string) => green(t),
  hr: (t: string) => gray(t),
  listBullet: (t: string) => green(t),
  bold: (t: string) => bold(t),
  italic: (t: string) => `\x1b[3m${t}\x1b[0m`,
  strikethrough: (t: string) => `\x1b[9m${t}\x1b[0m`,
  underline: (t: string) => `\x1b[4m${t}\x1b[0m`,
};

// ─── 命令解析结果 ──────────────────────────────────
type CommandResult =
  | { type: "ai"; message: string }
  | { type: "direct"; text: string }
  | { type: "setup" };

// ─── 快捷命令定义 ──────────────────────────────────
const COMMANDS: Record<string, string> = {
  "/shop": "根据库存生成购物建议",
  "/plan": "生成晚饭计划",
  "/tired": "低能量版本晚饭计划",
  "/today": "查看今日总结",
  "/stock": "查看当前库存",
  "/log": "快速记录用餐（用法: /log 番茄炒蛋、米饭）",
  "/prep": "生成周末备菜任务",
  "/profile": "查看当前配置（用户画像+厨房+食材）",
  "/recipe": "管理自定义菜谱（add/list/search/del）",
  "/calibrate": "校准菜谱热量（/calibrate 菜名 实际热量）",
  "/history": "搜索/浏览/导出对话历史",
  "/setup": "重新配置 API Key、饮食目标和厨房",
  "/help": "显示命令列表",
};

function handleCommand(raw: string): CommandResult | null {
  const [cmd, ...rest] = raw.trim().split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd) {
    case "/shop":
      return { type: "ai", message: "帮我生成今天的购物清单，根据我的库存推荐需要买什么" };
    case "/plan":
      return { type: "ai", message: "帮我安排今晚的晚饭计划" };
    case "/tired":
      return { type: "ai", message: "我今天很累，帮我安排一个省力的晚饭方案" };
    case "/today":
      return { type: "ai", message: "今天吃得怎么样？给我看看今日饮食总结" };
    case "/stock": {
      const inv = store.getIngredientInventory(raw.split(/\s+/)[0] ?? "");
      // inv 已有 userId 在里面，但 handleCommand 不知道 userId，需要外部传
      // 这里返回 direct，让外部处理
      return null; // handled specially in processCommand
    }
    case "/log":
      return null;
    case "/prep":
      return { type: "ai", message: "帮我看看周末可以做什么备菜" };
    case "/setup":
      return { type: "setup" };
    case "/help": {
      const lines = [bold("📖 可用命令")];
      for (const [c, desc] of Object.entries(COMMANDS)) {
        lines.push(`  ${cyan(c.padEnd(10))} ${desc}`);
      }
      return { type: "direct", text: lines.join("\n") };
    }
    default:
      return null;
  }
}

function buildStockText(userId: string): string {
  const inv = store.getIngredientInventory(userId);
  const available = inv.availableIngredients
    .filter((item) => !item.status || item.status === "available")
    .map((item) => `${item.name}${item.amount ? `(${item.amount})` : ""}`);
  const shopping = inv.shoppingList
    .filter((item) => !item.status || item.status === "planned" || item.status === "available")
    .map((item) => item.name);

  const lines = [bold("📦 当前库存")];
  lines.push(available.length > 0 ? `  可用: ${available.join("、")}` : "  可用: （空）");
  if (shopping.length > 0) lines.push(`  待购: ${shopping.join("、")}`);
  return lines.join("\n");
}

const GOAL_LABELS: Record<string, string> = {
  healthier_eating: "健康饮食",
  fat_loss: "减脂",
  muscle_gain: "增肌",
  maintain: "保持现状",
  custom: "自定义",
};

function buildProfileText(userId: string): string {
  const profile = store.getUserProfile(userId);
  const kitchen = store.getKitchenProfile(userId);
  const inv = store.getIngredientInventory(userId);

  const lines: string[] = [bold("👤 当前配置")];

  if (profile) {
    lines.push("");
    lines.push(bold("饮食画像"));
    lines.push(`  目标: ${profile.goal ? (GOAL_LABELS[profile.goal] ?? profile.goal) : "未设置"}`);
    if (profile.heightCm || profile.weightKg) {
      lines.push(`  身高: ${profile.heightCm ? `${profile.heightCm}cm` : "未记录"} │ 体重: ${profile.weightKg ? `${profile.weightKg}kg` : "未记录"}`);
    }
    if (profile.avoidFoods?.length) lines.push(`  忌口: ${profile.avoidFoods.join("、")}`);
    if (profile.preferences?.length) lines.push(`  口味偏好: ${profile.preferences.join("、")}`);
  } else {
    lines.push(`  饮食画像: ${yellow("未配置")}，运行 /setup 进行设置`);
  }

  lines.push("");
  lines.push(bold("厨房配置"));
  lines.push(`  灶眼: ${kitchen.burners} 个 │ 烤箱: ${kitchen.hasOven ? "有" : "没有"}`);
  if (kitchen.cookware.length > 0) lines.push(`  厨具: ${kitchen.cookware.join("、")}`);
  if (kitchen.cookingPreferences.length > 0) lines.push(`  烹饪偏好: ${kitchen.cookingPreferences.join("、")}`);

  const available = inv.availableIngredients
    .filter((item) => !item.status || item.status === "available")
    .map((item) => item.name);
  if (available.length > 0) {
    lines.push("");
    lines.push(bold("常备食材"));
    lines.push(`  ${available.join("、")}`);
  }

  return lines.join("\n");
}

const MEAL_TYPE_HINTS: Record<string, MealType> = {
  早: "breakfast", 早餐: "breakfast", b: "breakfast",
  午: "lunch", 午餐: "lunch", l: "lunch",
  晚: "dinner", 晚餐: "dinner", d: "dinner",
  夜宵: "snack", 加餐: "snack", 零食: "snack", s: "snack",
};

function guessMealTypeByTime(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

function parseAndLogMeal(userId: string, arg: string): string | null {
  if (!arg.trim()) return null;

  let mealType = guessMealTypeByTime();
  let foodText = arg;

  const words = arg.split(/\s+/);
  const first = words[0];
  if (MEAL_TYPE_HINTS[first]) {
    mealType = MEAL_TYPE_HINTS[first];
    foodText = words.slice(1).join(" ");
  }

  if (!foodText.trim()) return null;

  const foods = foodText
    .split(/[、,，;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(.+?)\s*[\(（]\s*(.+?)\s*[\)）]$/);
      if (m) return { name: m[1].trim(), amount: m[2].trim() };
      return { name: item, amount: "1 份" };
    });

  if (foods.length === 0) return null;

  const mealLog = store.addMealLog({ userId, mealType, foods });

  const MEAL_LABELS: Record<string, string> = {
    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐", unknown: "其他",
  };
  const foodDesc = foods.map((f) => `${f.name} ${f.amount}`).join("、");

  return [
    bold(`✅ 已记录${MEAL_LABELS[mealType]}`),
    `  ${foodDesc}`,
    `  记录 ID: ${mealLog.id}`,
    "",
    `  ${gray("如需修改，直接告诉 AI，例如「把刚才那条改成午餐」")}`,
  ].join("\n");
}

const ROLE_ICONS: Record<string, string> = {
  user: "🧑",
  assistant: "🤖",
  system: "ℹ️",
};

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 1) + "…";
}

function highlightKeyword(text: string, keyword: string): string {
  const re = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.replace(re, bold(yellow("$1")));
}

function snippetAround(text: string, keyword: string, radius = 40): string {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const idx = lower.indexOf(kw);
  if (idx < 0) return truncate(text, 80);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.substring(start, end) + suffix;
}

function formatHistorySearch(messages: store.ChatMessage[], keyword: string): string {
  const lines = [bold(`🔍 搜索 "${keyword}" — ${messages.length} 条结果`), ""];
  for (const msg of messages) {
    const icon = ROLE_ICONS[msg.role] ?? msg.role;
    const time = msg.createdAt.substring(5, 16).replace("T", " ");
    const snip = highlightKeyword(snippetAround(msg.content, keyword), keyword);
    lines.push(`  ${icon} ${gray(time)} ${snip}`);
  }
  return lines.join("\n");
}

function formatHistoryRecent(messages: store.ChatMessage[]): string {
  const lines = [bold(`📜 最近 ${messages.length} 条消息`), ""];
  for (const msg of messages) {
    const icon = ROLE_ICONS[msg.role] ?? msg.role;
    const time = msg.createdAt.substring(5, 16).replace("T", " ");
    lines.push(`  ${icon} ${gray(time)} ${truncate(msg.content.replace(/\n/g, " "), 50)}`);
  }
  lines.push("");
  lines.push(gray("  输入 /history 关键词 搜索，/history export 导出"));
  return lines.join("\n");
}

function exportHistory(userId: string): string {
  const messages = store.getAllChatMessages(userId);
  if (messages.length === 0) return yellow("  暂无对话记录");

  const date = new Date().toISOString().substring(0, 10);
  const dir = resolve(process.cwd(), "exports");
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, `history-${date}.md`);

  const ROLE_LABELS: Record<string, string> = { user: "🧑 你", assistant: "🤖 饮食助手", system: "ℹ️ 系统" };
  const mdLines = [`# 对话历史 — ${date}`, "", `用户: ${userId}`, `导出时间: ${new Date().toLocaleString("zh-CN")}`, "", "---", ""];

  for (const msg of messages) {
    const time = msg.createdAt.replace("T", " ").substring(0, 19);
    mdLines.push(`### ${ROLE_LABELS[msg.role] ?? msg.role} — ${time}`);
    mdLines.push("");
    mdLines.push(msg.content);
    mdLines.push("");
    mdLines.push("---");
    mdLines.push("");
  }

  writeFileSync(filePath, mdLines.join("\n"), "utf-8");
  return green(`  ✓ 已导出 ${messages.length} 条消息到 ${filePath}`);
}

function rlQuestion(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function handleHistoryInteractive(userId: string, fullArg: string): Promise<string> {
  const parts = fullArg.trim().split(/\s+/);
  const sub = parts[0];

  if (!sub || sub === "recent") {
    const limit = parseInt(parts[1], 10) || 20;
    const messages = store.getRecentChatMessages(userId, limit);
    if (messages.length === 0) return yellow("  暂无对话记录");
    return formatHistoryRecent(messages);
  }

  if (sub === "export") {
    return exportHistory(userId);
  }

  const keyword = fullArg.trim();
  const lastPart = parts[parts.length - 1];
  let limit = 10;
  if (parts.length > 1 && /^\d+$/.test(lastPart)) {
    limit = parseInt(lastPart, 10);
    return formatHistorySearch(store.searchChatMessages(userId, parts.slice(0, -1).join(" "), limit), parts.slice(0, -1).join(" "));
  }

  return formatHistorySearch(store.searchChatMessages(userId, keyword, limit), keyword);
}

// ─── /recipe 交互处理 ──────────────────────────────────
function rlAsk(rl: ReturnType<typeof createInterface>, prompt: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` ${gray(`[${defaultValue}]`)} ` : " ";
    rl.question(`${prompt}${hint}: `, (answer) => {
      resolve(((answer.trim() || defaultValue) ?? "").trim());
    });
  });
}

async function handleRecipeInteractive(userId: string, fullArg: string): Promise<string> {
  const parts = fullArg.trim().split(/\s+/);
  const sub = parts[0];

  if (sub === "list" || !sub) {
    const recipes = store.getUserRecipes(userId);
    if (recipes.length === 0) return yellow("  暂无自定义菜谱，运行 /recipe add 添加");
    const lines = [bold(`📖 自定义菜谱（${recipes.length} 道）`), ""];
    for (const r of recipes) {
      const cal = r.estimatedCalories ? `约${r.estimatedCalories}kcal` : "";
      const time = r.activeMinutes ? `${r.activeMinutes}分钟` : "";
      const meta = [cal, time].filter(Boolean).join(" │ ");
      lines.push(`  ${r.name}${meta ? ` (${meta})` : ""}`);
      lines.push(`    食材: ${r.ingredients.join("、")}`);
    }
    return lines.join("\n");
  }

  if (sub === "search") {
    const keyword = parts.slice(1).join(" ");
    if (!keyword) return yellow("  用法: /recipe search 关键词");
    const results = store.searchUserRecipes(userId, keyword);
    if (results.length === 0) return `  未找到包含"${keyword}"的菜谱`;
    const lines = [bold(`🔍 搜索"${keyword}" — ${results.length} 道菜谱`), ""];
    for (const r of results) {
      lines.push(`  ${r.name} — 食材: ${r.ingredients.join("、")}`);
    }
    return lines.join("\n");
  }

  if (sub === "del" || sub === "delete" || sub === "rm") {
    const name = parts.slice(1).join(" ");
    if (!name) return yellow("  用法: /recipe del 菜名");
    const recipes = store.getUserRecipes(userId);
    const target = recipes.find((r) => r.name.includes(name) || name.includes(r.name));
    if (!target) return yellow(`  未找到菜谱"${name}"`);
    const ok = store.deleteUserRecipe(userId, target.id);
    return ok ? green(`  ✓ 已删除菜谱「${target.name}」`) : yellow("  删除失败");
  }

  if (sub === "add") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const name = await rlAsk(rl, "菜名");
      if (!name) return yellow("  已取消");

      const ingredientsStr = await rlAsk(rl, "食材（逗号分隔）", "");
      const ingredients = ingredientsStr.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);

      console.log(gray("  输入步骤，每行一步，空行结束："));
      const steps: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const step = await rlAsk(rl, `  Step ${i}`, "");
        if (!step) break;
        steps.push(step);
      }

      const calStr = await rlAsk(rl, "估算热量(kcal)", "");
      const estimatedCalories = calStr ? parseInt(calStr, 10) : undefined;

      const tagsStr = await rlAsk(rl, "标签（如快手、一锅出、减脂，逗号分隔）", "");
      const tags = tagsStr.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);

      const activeStr = await rlAsk(rl, "主动操作时间(分钟)", "");
      const activeMinutes = activeStr ? parseInt(activeStr, 10) : undefined;

      const recipe = store.addUserRecipe({
        userId, name, ingredients, steps,
        estimatedCalories: Number.isNaN(estimatedCalories) ? undefined : estimatedCalories,
        tags,
        activeMinutes: Number.isNaN(activeMinutes) ? undefined : activeMinutes,
      });

      return green(`  ✓ 已添加菜谱「${recipe.name}」(${recipe.ingredients.length} 种食材, ${recipe.steps.length} 步)`);
    } finally {
      rl.close();
    }
  }

  return yellow("  用法: /recipe add|list|search|del");
}

// ─── /calibrate 交互处理 ──────────────────────────────────
function handleCalibrateCommand(userId: string, fullArg: string): string {
  const parts = fullArg.trim().split(/\s+/);
  const sub = parts[0];

  if (sub === "list" || !sub) {
    const corrections = store.getCalorieCorrections(userId);
    if (corrections.length === 0) return yellow("  暂无热量校准记录，用法: /calibrate 菜名 实际热量");
    const seen = new Map<string, store.CalorieCorrection>();
    for (const c of corrections) seen.set(c.recipeName, c);
    const lines = [bold(`🔬 热量校准记录（${seen.size} 道菜，共 ${corrections.length} 次校准）`), ""];
    for (const [, c] of seen) {
      const orig = c.originalCalories ? `${c.originalCalories} → ` : "";
      lines.push(`  ${c.recipeName}: ${orig}${c.correctedCalories}kcal`);
    }
    return lines.join("\n");
  }

  // /calibrate 菜名 热量值
  const calStr = parts[parts.length - 1];
  const cal = parseInt(calStr, 10);
  if (Number.isNaN(cal) || parts.length < 2) {
    return yellow("  用法: /calibrate 菜名 实际热量(kcal)\n  例如: /calibrate 番茄炒蛋 180");
  }

  const recipeName = parts.slice(0, -1).join(" ");

  // Try to find original calories from user recipes or built-in
  let originalCalories: number | undefined;
  const userRecipes = store.searchUserRecipes(userId, recipeName);
  if (userRecipes.length > 0 && userRecipes[0].estimatedCalories) {
    originalCalories = userRecipes[0].estimatedCalories;
  }

  const entry = store.addCalorieCorrection({
    userId,
    recipeName,
    originalCalories,
    correctedCalories: cal,
    source: "user",
  });

  const totalCorrections = store.getCalorieCorrections(userId).length;
  const lines = [green(`  ✓ 已校准「${recipeName}」`)];
  if (originalCalories) {
    lines.push(`    ${originalCalories}kcal → ${cal}kcal (${cal > originalCalories ? "+" : ""}${cal - originalCalories})`);
  } else {
    lines.push(`    已设为 ${cal}kcal`);
  }
  lines.push(`    累计校准 ${totalCorrections} 次`);
  return lines.join("\n");
}

function classifyError(err: unknown): string {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? (err as any)?.code ?? "";
  const full = `${msg} ${String(status).toLowerCase()}`;

  if (
    full.includes("401") || full.includes("403") ||
    full.includes("invalid api key") || full.includes("invalid_api_key") ||
    full.includes("authentication") || full.includes("unauthorized") ||
    full.includes("forbidden") || full.includes("apikey") || full.includes("api key")
  ) {
    return [
      bold("🔑 API Key 无效或已过期"),
      `  原因: ${err instanceof Error ? err.message : String(err)}`,
      "",
      "  建议操作：",
      `  1. 运行 ${cyan("/setup")} 重新配置 API Key`,
      "  2. 检查 .env 文件中的 Key 是否正确",
      "  3. 确认 Key 是否已过期或被撤销",
    ].join("\n");
  }

  if (
    full.includes("429") || full.includes("rate limit") || full.includes("rate_limit") ||
    full.includes("quota") || full.includes("insufficient") ||
    full.includes("too many") || full.includes("throttl") || full.includes("capacity")
  ) {
    return [
      bold("⏱️ 额度不足或请求过快"),
      `  原因: ${err instanceof Error ? err.message : String(err)}`,
      "",
      "  建议操作：",
      "  1. 等待几分钟后重试",
      `  2. 运行 ${cyan("/setup")} 切换到其他模型供应商`,
      "  3. 检查 API 账户余额",
    ].join("\n");
  }

  if (
    full.includes("econnrefused") || full.includes("enotfound") ||
    full.includes("etimedout") || full.includes("econnreset") ||
    full.includes("fetch failed") || full.includes("network") ||
    full.includes("socket hang up") || full.includes("dns") ||
    full.includes("proxy") || full.includes("connect econn")
  ) {
    return [
      bold("🌐 网络连接失败"),
      `  原因: ${err instanceof Error ? err.message : String(err)}`,
      "",
      "  建议操作：",
      "  1. 检查网络连接是否正常",
      "  2. 如需代理，确认 HTTPS_PROXY 环境变量已设置",
      "  3. 重试一次",
    ].join("\n");
  }

  return [
    bold("❌ 请求失败"),
    `  原因: ${err instanceof Error ? err.message : String(err)}`,
    "",
    "  建议操作：",
    `  1. 重试一次，或运行 ${cyan("/setup")} 检查配置`,
    "  2. 如果持续失败，检查 .env 文件和网络环境",
  ].join("\n");
}

// ─── 消息气泡组件 ──────────────────────────────────
class ChatBubble implements Component {
  private cachedLines: string[] = [];
  private cachedWidth = 0;

  constructor(
    private role: "user" | "assistant" | "system",
    private content: string
  ) {}

  invalidate() { this.cachedWidth = 0; }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedLines.length > 0) {
      return this.cachedLines;
    }
    this.cachedWidth = width;

    const maxWidth = Math.min(width - 2, 80);
    const lines: string[] = [];

    if (this.role === "user") lines.push(green("🧑 你"));
    else if (this.role === "assistant") lines.push(cyan("🤖 饮食助手"));
    else lines.push(yellow("ℹ️ 系统"));

    const md = new Markdown(this.content, 2, 0, chatMarkdownTheme);
    lines.push(...md.render(maxWidth));
    lines.push(gray("─".repeat(Math.min(width, 60))));
    lines.push("");

    this.cachedLines = lines;
    return lines;
  }
}

// ─── 主 TUI 应用 ──────────────────────────────────
export async function startChatTUI(userId: string) {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const messagesContainer = new Box(0, 0);

  const loader = new Loader(
    tui, (s) => cyan(s), (s) => dim(s), "正在思考...",
    { frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], intervalMs: 80 }
  );

  const input = new Input();
  const inputBox = new Box(1, 0, (s) => `\x1b[48;5;235m${s}\x1b[0m`);
  inputBox.addChild(input);

  const statusText = new Text(
    gray(` ${bold("Ctrl+C")} 退出 │ ${bold("Enter")} 发送 │ 用户: ${cyan(userId)} │ ${bold("/help")} 命令列表`),
    0, 0
  );

  const welcomeText = [
    bold(cyan("🥗 饮食管理智能体")),
    "",
    "所有操作通过聊天完成，也可以用快捷命令：",
    gray("  /plan   生成晚饭计划     /tired  低能量版"),
    gray("  /shop   购物建议         /stock  查看库存"),
    gray("  /log    记录晚餐         /today  今日总结"),
    gray("  /prep   周末备菜         /profile 查看配置"),
    gray("  /history 搜索历史        /setup  重新配置"),
    gray("  /recipe  自定义菜谱      /calibrate 校准热量"),
    "",
    "直接输入你想吃什么、吃了什么，或问我任何问题。",
    "",
  ].join("\n");

  const welcomeMd = new Markdown(welcomeText, 1, 0, chatMarkdownTheme);

  // 加载历史消息
  const history = store.getRecentChatMessages(userId, 50);

  tui.addChild(welcomeMd);

  if (history.length > 0) {
    const separator = new Markdown(gray("── 以上是历史消息 ──\n"), 1, 0, chatMarkdownTheme);
    for (const msg of history) {
      const role = msg.role as "user" | "assistant" | "system";
      messagesContainer.addChild(new ChatBubble(role, msg.content));
    }
    tui.addChild(separator);
  }

  tui.addChild(messagesContainer);
  tui.addChild(loader);
  tui.addChild(inputBox);
  tui.addChild(statusText);

  loader.stop();
  loader.setMessage("");
  tui.setFocus(input);

  // ─── 消息处理 ──────────────────────────────────
  let isWaiting = false;

  async function processCommand(text: string) {
    if (isWaiting) return;

    const cmd = text.trim().split(/\s+/)[0];

    // /setup: 暂停 TUI，跑交互式配置
    if (cmd === "/setup") {
      tui.stop();
      console.log("");
      await startSetupCommand(userId);
      tui.start();
      tui.setFocus(input);
      return;
    }

    // /stock: 直接显示库存气泡
    if (cmd === "/stock") {
      messagesContainer.addChild(new ChatBubble("system", buildStockText(userId)));
      tui.requestRender();
      return;
    }

    // /profile: 直接显示当前配置
    if (cmd === "/profile") {
      messagesContainer.addChild(new ChatBubble("system", buildProfileText(userId)));
      tui.requestRender();
      return;
    }

    // /log: 直接解析并记录，解析失败则交给 AI
    if (cmd === "/log") {
      const arg = text.trim().split(/\s+/).slice(1).join(" ");
      const result = parseAndLogMeal(userId, arg);
      if (result) {
        messagesContainer.addChild(new ChatBubble("system", result));
        tui.requestRender();
        return;
      }
    }

    // /history: 搜索/浏览/导出对话历史
    if (cmd === "/history") {
      const arg = text.trim().split(/\s+/).slice(1).join(" ");
      const result = await handleHistoryInteractive(userId, arg);
      messagesContainer.addChild(new ChatBubble("system", result));
      tui.requestRender();
      return;
    }

    // /recipe: 管理自定义菜谱
    if (cmd === "/recipe") {
      const arg = text.trim().split(/\s+/).slice(1).join(" ");
      if (arg.startsWith("add")) {
        tui.stop();
        console.log("");
        const result = await handleRecipeInteractive(userId, arg);
        tui.start();
        tui.setFocus(input);
        messagesContainer.addChild(new ChatBubble("system", result));
        tui.requestRender();
        return;
      }
      const result = await handleRecipeInteractive(userId, arg);
      messagesContainer.addChild(new ChatBubble("system", result));
      tui.requestRender();
      return;
    }

    // /calibrate: 校准菜谱热量
    if (cmd === "/calibrate") {
      const arg = text.trim().split(/\s+/).slice(1).join(" ");
      const result = handleCalibrateCommand(userId, arg);
      messagesContainer.addChild(new ChatBubble("system", result));
      tui.requestRender();
      return;
    }

    // 其他 / 命令
    if (cmd?.startsWith("/")) {
      const result = handleCommand(text);
      if (result?.type === "direct") {
        messagesContainer.addChild(new ChatBubble("system", result.text));
        tui.requestRender();
        return;
      }
      if (result?.type === "ai") {
        await sendToAgent(result.message, text);
        return;
      }
      // 未知命令，当作普通消息发送给 AI
    }

    await sendToAgent(text, text);
  }

  async function sendToAgent(agentMessage: string, displayText: string) {
    isWaiting = true;

    messagesContainer.addChild(new ChatBubble("user", displayText));
    tui.requestRender();

    loader.setMessage("正在思考...");
    loader.start();
    tui.requestRender();

    try {
      const data = await sendDietAgentMessage(userId, agentMessage);

      loader.stop();
      loader.setMessage("");

      messagesContainer.addChild(new ChatBubble("assistant", data.reply));
    } catch (err: any) {
      loader.stop();
      loader.setMessage("");
      messagesContainer.addChild(new ChatBubble("system", classifyError(err)));
    }

    isWaiting = false;
    tui.requestRender();
  }

  input.onSubmit = (value: string) => {
    const text = value.trim();
    if (!text) return;
    input.setValue("");
    processCommand(text);
  };

  tui.addInputListener((data: string) => {
    if (matchesKey(data, "ctrl+c")) {
      tui.stop();
      process.exit(0);
    }
    return undefined;
  });

  terminal.setTitle("🥗 饮食管理智能体");
  console.clear();
  tui.start();
}
