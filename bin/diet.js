#!/usr/bin/env node
/**
 * diet-agent CLI 入口
 *
 * 用法：
 *   npx diet-agent              — 启动终端聊天
 *   diet-agent [userId]         — npm link / npm install -g 后直接用，可指定 userId
 *   diet-agent --help           — 显示帮助
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

// 解析参数：去掉 flag，剩余第一个非 flag 视为 userId
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const userIdArg = args.find((a) => !a.startsWith("--"));

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`
🍳 晚饭工作流 — 个人饮食管理智能体（终端模式）

用法:
  diet-agent              启动终端聊天
  diet-agent <userId>     指定用户 ID（默认 tui_user）
  diet-agent --help       显示帮助

环境变量（.env 文件）:
  DEEPSEEK_API_KEY    DeepSeek API Key（推荐，性价比高）
  ZAI_API_KEY         智谱 GLM API Key（国内稳定）
  USER_ID             默认用户 ID

首次使用可在终端里告诉助手你的饮食目标、厨房条件等，它会自动记录。
`);
  process.exit(0);
}

// 前置检查：确保 .env 存在
const envPath = resolve(projectRoot, ".env");
if (!existsSync(envPath)) {
  const template = resolve(projectRoot, ".env.example");
  if (existsSync(template)) {
    copyFileSync(template, envPath);
    console.log("✅ 已从模板创建 .env 文件");
  }
}

// 检查 API Key
import { config } from "dotenv";
config({ path: envPath });
const hasKey = process.env.DEEPSEEK_API_KEY || process.env.ZAI_API_KEY ||
  process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
if (!hasKey) {
  console.log(`\n⚠️  未检测到 API Key。请编辑 .env 填入至少一个 Key：`);
  console.log(`   ${envPath}`);
  console.log("   推荐 DeepSeek（性价比高）: https://platform.deepseek.com/\n");
}

// 确定 tsx 路径
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let tsxCli;
try {
  tsxCli = resolve(require.resolve("tsx/package.json"), "../dist/cli.mjs");
} catch {
  console.error("❌ 找不到 tsx，请先 npm install");
  process.exit(1);
}

const entryFile = resolve(projectRoot, "src/tui/index.ts");

// 用 tsx 启动（传入 userId 作为首个位置参数）
const childArgs = [tsxCli, entryFile];
if (userIdArg) childArgs.push(userIdArg);

const child = spawn(process.execPath, childArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});
