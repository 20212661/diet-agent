#!/usr/bin/env node
/**
 * 饮食管理智能体 TUI 入口
 * 用法: npx tsx src/tui/index.ts [userId]
 */

import "dotenv/config";
import { checkModelConfiguration, formatModelCheckResult } from "../agent/configDoctor.js";
import { installRequestLogger } from "../utils/requestLogger.js";

async function main() {
  const check = await checkModelConfiguration();
  if (check.severity !== "ok") console.error(formatModelCheckResult(check));
  if (check.severity === "error") {
    console.error("运行 npm run doctor 查看配置诊断。TUI 未启动，避免到首次聊天时才失败。");
    process.exitCode = 1;
    return;
  }

  // 仅在 ENABLE_REQUEST_LOGGING=1 时安装请求日志；日志可能包含敏感饮食信息。
  installRequestLogger();

  const userId = process.argv[2] ?? process.env.USER_ID ?? "tui_user";
  const { disposeAllAgentSessions } = await import("../agent/createDietAgent.js");
  const { closeDatabase } = await import("../store/index.js");
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    disposeAllAgentSessions();
    closeDatabase();
  };
  process.once("exit", cleanup);
  if (process.env.DIET_TUI_MODE?.trim().toLowerCase() === "legacy") {
    process.once("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    const { startChatTUI } = await import("./chat-tui.js");
    await startChatTUI(userId);
  } else {
    const { startPiInteractiveApp } = await import("./pi-interactive.js");
    await startPiInteractiveApp(userId);
  }
}

main().catch((err) => {
  console.error("TUI 启动失败:", err);
  process.exitCode = 1;
});
