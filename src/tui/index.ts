#!/usr/bin/env node
/**
 * 饮食管理智能体 TUI 入口
 * 用法: npx tsx src/tui/index.ts [userId]
 */

import "dotenv/config";
import { startChatTUI } from "./chat-tui.js";

const userId = process.argv[2] ?? process.env.USER_ID ?? "tui_user";

startChatTUI(userId).catch((err) => {
  console.error("TUI 启动失败:", err);
  process.exit(1);
});
