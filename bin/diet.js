#!/usr/bin/env node
/**
 * diet-agent CLI 入口
 *
 * 用法：
 *   diet-agent          启动终端聊天
 *   diet-agent --help   显示帮助
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
🍳 晚饭工作流 — 个人饮食管理智能体

用法:
  diet-agent              启动终端聊天
  diet-agent --help       显示帮助

环境变量（.env 文件）:
  DEEPSEEK_API_KEY    DeepSeek API Key（推荐，性价比高）
  ZAI_API_KEY         智谱 GLM API Key（国内稳定）
  USER_ID             用户名（默认 tui_user）

首次使用会自动弹出引导向导。
快捷命令: /shop /plan /tired /log /prep /setup /today
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

const child = spawn(process.execPath, [tsxCli, entryFile, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});
