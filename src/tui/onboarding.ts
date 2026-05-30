import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";
import * as store from "../store/index.js";
import type { UserGoal } from "../types/diet.js";

const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

const PROVIDERS = [
  { key: "DEEPSEEK_API_KEY", label: "DeepSeek（推荐，性价比高）", url: "https://platform.deepseek.com/" },
  { key: "ZAI_API_KEY", label: "智谱 GLM（国内稳定）", url: "https://open.bigmodel.cn/" },
  { key: "OPENAI_API_KEY", label: "OpenAI（GPT 系列）", url: "https://platform.openai.com/" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic（Claude 系列）", url: "https://console.anthropic.com/" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter（聚合网关）", url: "https://openrouter.ai/" },
] as const;

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} ${gray(`[${defaultValue}]`)}: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(((answer.trim() || defaultValue) ?? "").trim());
    });
  });
}

function choose(rl: ReturnType<typeof createInterface>, title: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n${bold(title)}`);
    options.forEach((opt, i) => console.log(`  ${cyan(String(i + 1))}. ${opt}`));
    rl.question(`  选择 (1-${options.length}): `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      resolve(idx >= 0 && idx < options.length ? options[idx] : options[0]);
    });
  });
}

function splitCSV(value: string): string[] {
  return value.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);
}

function detectConfiguredProvider(): { key: string; label: string } | null {
  for (const p of PROVIDERS) {
    if (process.env[p.key]) return { key: p.key, label: p.label };
  }
  return null;
}

function getEnvPath(): string {
  return resolve(process.cwd(), ".env");
}

function writeApiKeyToEnv(key: string, value: string): void {
  const envPath = getEnvPath();
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  const lines = content.split("\n");
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(envPath, lines.join("\n"), "utf-8");

  process.env[key] = value;
}

async function setupApiKey(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log(`\n${bold(cyan("🔑 API Key 配置"))}`);
  console.log(gray("   需要一个 AI 模型的 API Key 才能使用助手功能"));

  const configured = detectConfiguredProvider();
  if (configured) {
    console.log(green(`  ✓ 已检测到 ${configured.label} (${configured.key})`));
    const change = await ask(rl, "是否更换？(y/N)", "N");
    if (!/^y|yes|是$/i.test(change)) return;
  }

  const labels = PROVIDERS.map((p) => `${p.label}`);
  const choice = await choose(rl, "选择模型供应商", labels);
  const provider = PROVIDERS[labels.indexOf(choice)];

  console.log(gray(`   注册地址: ${provider.url}`));
  const apiKey = await ask(rl, `输入 ${provider.key}`);
  if (!apiKey) {
    console.log(yellow("  ⚠ 跳过 API Key 设置，之后可通过 /setup 重新配置"));
    return;
  }

  writeApiKeyToEnv(provider.key, apiKey);
  console.log(green(`  ✓ ${provider.key} 已保存到 .env`));
}

export async function startOnboardingIfNeeded(userId: string): Promise<void> {
  const profile = store.getUserProfile(userId);
  const hasApiKey = !!detectConfiguredProvider();
  const needsProfile = !profile?.goal;

  if (hasApiKey && !needsProfile) return;

  console.log(`\n${bold(cyan("👋 欢迎！第一次使用，先做几个简单设置"))}`);
  console.log(gray("   随时可以跳过（直接回车），之后用 /setup 重新配置\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  if (!hasApiKey) {
    await setupApiKey(rl);
    dotenvConfig({ path: getEnvPath(), override: true });
  }

  if (needsProfile) {
    await collectProfile(rl, userId);
  }

  rl.close();
}

async function collectProfile(rl: ReturnType<typeof createInterface>, userId: string): Promise<void> {
  const goalLabels: Record<string, UserGoal> = {
    "健康饮食": "healthier_eating",
    "减脂": "fat_loss",
    "增肌": "muscle_gain",
    "保持现状": "maintain",
  };
  const goalLabel = await choose(rl, "Step 1/2: 饮食目标", Object.keys(goalLabels));
  const goal = goalLabels[goalLabel];

  const heightStr = await ask(rl, "身高(cm)", "175");
  const weightStr = await ask(rl, "体重(kg)", "70");
  const avoidFoods = splitCSV(await ask(rl, "忌口（逗号分隔）", ""));
  const preferences = splitCSV(await ask(rl, "口味偏好（逗号分隔）", ""));

  const burnersStr = await choose(rl, "Step 2/2: 灶眼数量", ["1 个", "2 个", "3 个", "4 个"]);
  const burners = parseInt(burnersStr, 10) || 2;
  const hasOvenStr = await choose(rl, "有烤箱？", ["有", "没有"]);
  const hasOven = hasOvenStr === "有";
  const cookwareStr = await ask(rl, "厨具（逗号分隔）", "炒锅, 汤锅");
  const cookPrefsStr = await ask(rl, "烹饪偏好（逗号分隔）", "快手, 少洗碗");
  const ingredientsStr = await ask(rl, "常备食材（逗号分隔）", "鸡蛋, 番茄, 蒜, 面条");

  console.log(`\n${bold(green("✓ 配置汇总"))}`);
  console.log(`  目标: ${goalLabel} │ 身高: ${heightStr}cm │ 体重: ${weightStr}kg`);
  console.log(`  忌口: ${avoidFoods.length > 0 ? avoidFoods.join("、") : "无"}`);
  console.log(`  灶台: ${burnersStr} │ 烤箱: ${hasOvenStr}`);
  console.log(`  常备: ${ingredientsStr}`);
  console.log(green("\n  配置已保存，开始聊天吧！\n"));

  store.upsertUserProfile(userId, {
    goal,
    heightCm: parseFloat(heightStr) || undefined,
    weightKg: parseFloat(weightStr) || undefined,
    avoidFoods: avoidFoods.length > 0 ? avoidFoods : undefined,
    preferences: preferences.length > 0 ? preferences : undefined,
  });

  store.upsertKitchenProfile(userId, {
    burners,
    hasOven,
    cookware: splitCSV(cookwareStr),
    cookingPreferences: splitCSV(cookPrefsStr),
  });

  const ingredients = splitCSV(ingredientsStr).map((name) => ({
    name,
    status: "available" as const,
    storage: "fridge" as const,
  }));
  if (ingredients.length > 0) {
    store.upsertIngredientInventory(userId, { availableIngredients: ingredients });
  }
}

export async function startSetupCommand(userId: string): Promise<void> {
  console.log(`\n${bold(yellow("⚙️ 重新配置"))}`);
  console.log(gray("   当前配置会被覆盖\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  await setupApiKey(rl);
  dotenvConfig({ path: getEnvPath(), override: true });

  const goalLabels: Record<string, UserGoal> = {
    "健康饮食": "healthier_eating",
    "减脂": "fat_loss",
    "增肌": "muscle_gain",
    "保持现状": "maintain",
  };
  const goalLabel = await choose(rl, "饮食目标", Object.keys(goalLabels));
  const goal = goalLabels[goalLabel];

  const existing = store.getUserProfile(userId);
  const heightStr = await ask(rl, "身高(cm)", existing?.heightCm ? String(existing.heightCm) : "");
  const weightStr = await ask(rl, "体重(kg)", existing?.weightKg ? String(existing.weightKg) : "");
  const avoidFoods = splitCSV(await ask(rl, "忌口（逗号分隔）", existing?.avoidFoods?.join(", ") ?? ""));
  const preferences = splitCSV(await ask(rl, "口味偏好（逗号分隔）", existing?.preferences?.join(", ") ?? ""));

  const kitchen = store.getKitchenProfile(userId);
  const burnersStr = await choose(rl, "灶眼数量", ["1 个", "2 个", "3 个", "4 个"]);
  const burners = parseInt(burnersStr, 10) || 2;
  const hasOvenStr = await choose(rl, "有烤箱？", ["有", "没有"]);
  const hasOven = hasOvenStr === "有";
  const cookwareStr = await ask(rl, "厨具（逗号分隔）", kitchen.cookware.join(", ") || "炒锅, 汤锅");
  const cookPrefsStr = await ask(rl, "烹饪偏好（逗号分隔）", kitchen.cookingPreferences.join(", ") || "快手, 少洗碗");

  const ingredientsStr = await ask(rl, "常备食材（逗号分隔）", "");

  rl.close();

  store.upsertUserProfile(userId, {
    goal,
    heightCm: parseFloat(heightStr) || undefined,
    weightKg: parseFloat(weightStr) || undefined,
    avoidFoods: avoidFoods.length > 0 ? avoidFoods : undefined,
    preferences: preferences.length > 0 ? preferences : undefined,
  });

  store.upsertKitchenProfile(userId, {
    burners,
    hasOven,
    cookware: splitCSV(cookwareStr),
    cookingPreferences: splitCSV(cookPrefsStr),
  });

  const ingredients = splitCSV(ingredientsStr).map((name) => ({
    name,
    status: "available" as const,
    storage: "fridge" as const,
  }));
  if (ingredients.length > 0) {
    store.upsertIngredientInventory(userId, { availableIngredients: ingredients, replaceAvailable: true });
  }

  console.log(green("\n✓ 配置已更新\n"));
}
