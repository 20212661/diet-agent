#!/usr/bin/env node
/**
 * diet-agent CLI 入口
 * 
 * 用法：
 *   npx diet-agent          — 启动 Web 服务
 *   diet-agent              — npm link / npm install -g 后直接用
 *   diet-agent --tui        — 启动终端聊天
 *   diet-agent --port 8080  — 指定端口
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

// 解析参数
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getParam = (f) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`
🍳 晚饭工作流 — 个人饮食管理智能体

用法:
  diet-agent              启动 Web 服务（默认 http://localhost:3001）
  diet-agent --tui        启动终端聊天模式
  diet-agent --port 8080  指定端口
  diet-agent --help       显示帮助

环境变量（.env 文件）:
  DEEPSEEK_API_KEY    DeepSeek API Key（推荐，性价比高）
  ZAI_API_KEY         智谱 GLM API Key（国内稳定）
  PORT                服务端口（默认 3001）

首次使用会自动弹出引导向导。
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

// 设置端口
process.env.PORT = getParam("--port") || process.env.PORT || "3001";

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

// 选择入口文件
const entryFile = hasFlag("--tui")
  ? resolve(projectRoot, "src/tui/index.ts")
  : resolve(projectRoot, "src/index.ts");

// 用 tsx 启动
const child = spawn(process.execPath, [tsxCli, entryFile], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});


