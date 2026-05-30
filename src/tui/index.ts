#!/usr/bin/env node
import "dotenv/config";
import { startOnboardingIfNeeded } from "./onboarding.js";
import { startChatTUI } from "./chat-tui.js";

const userId = process.argv[2] ?? process.env.USER_ID ?? "tui_user";

async function main() {
  await startOnboardingIfNeeded(userId);
  await startChatTUI(userId);
}

main().catch((err) => {
  console.error("TUI 启动失败:", err);
  process.exit(1);
});
