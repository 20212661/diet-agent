import "dotenv/config";
import { basename } from "node:path";
import { disposeAllAgentSessions } from "../agent/createDietAgent.js";
import * as store from "../store/index.js";
import { isLoopbackHost, normalizeHostName } from "./middleware/security.js";
import { createWebServer } from "./server.js";

const userId = process.argv[2] ?? process.env.USER_ID ?? "tui_user";
const port = Number(process.env.WEB_PORT ?? "4173");
const host = normalizeHostName(process.env.WEB_HOST ?? "127.0.0.1");
const urlHost = host.includes(":") ? `[${host}]` : host;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("WEB_PORT must be an integer from 1 to 65535.");
}

if (!isLoopbackHost(host)) {
  console.error("[WEB] Refusing non-loopback WEB_HOST. This application has no remote-user login; bind only to localhost, 127.0.0.1, or ::1.");
  process.exit(1);
}

const server = createWebServer({ userId, port, host });

server.listen(port, host, () => {
  console.log(`🍳 饮食工作台已启动: http://${urlHost}:${port}`);
  console.log(`当前用户: ${userId} · 数据文件: ${basename(store.getDatabasePath())}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    disposeAllAgentSessions();
    store.closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2_000).unref();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { server, createWebServer };
