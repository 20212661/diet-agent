#!/usr/bin/env node
/**
 * 饮食管理智能体 TUI 入口
 * 用法: npx tsx src/tui/index.ts [userId]
 */

import "dotenv/config";
import { installRequestLogger } from "../utils/requestLogger.js";

// 安装 LLM API 请求日志（patch globalThis.fetch），保留调试能力
installRequestLogger();

const userId = process.argv[2] ?? process.env.USER_ID ?? "tui_user";

const { startChatTUI } = await import("./chat-tui.js");
startChatTUI(userId).catch((err) => {
  console.error("TUI 启动失败:", err);
  process.exit(1);
});
