import type { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sendJson } from "./http.js";

export const staticFiles: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/chatController.js": { file: "chatController.js", type: "text/javascript; charset=utf-8" },
  "/planDialog.js": { file: "planDialog.js", type: "text/javascript; charset=utf-8" },
  "/recoveryStore.js": { file: "recoveryStore.js", type: "text/javascript; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/viewFormatters.js": { file: "viewFormatters.js", type: "text/javascript; charset=utf-8" },
  "/profileKitchenViews.js": { file: "profileKitchenViews.js", type: "text/javascript; charset=utf-8" },
  "/inventoryView.js": { file: "inventoryView.js", type: "text/javascript; charset=utf-8" },
  "/diaryView.js": { file: "diaryView.js", type: "text/javascript; charset=utf-8" },
  "/planAgentViews.js": { file: "planAgentViews.js", type: "text/javascript; charset=utf-8" },
};

export async function serveStaticFile(publicDir: string, pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = staticFiles[pathname];
  if (!asset) return false;
  try {
    const content = await readFile(join(publicDir, asset.file));
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "工作台资源未找到。" });
  }
  return true;
}
