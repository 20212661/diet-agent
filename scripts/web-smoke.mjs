import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { claimChatOperation, finishChatOperation } from "../dist/web/chatOperationStore.js";

const directory = mkdtempSync(join(tmpdir(), "diet-agent-web-smoke-"));
const listener = createServer();
await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
const address = listener.address();
if (!address || typeof address === "string") throw new Error("No test port available");
const port = address.port;
await new Promise((resolve) => listener.close(resolve));

const child = spawn(process.execPath, ["dist/web/index.js", "web_smoke_user"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DIET_AGENT_DB_PATH: join(directory, "data.sqlite"),
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Web server exited early:\n${output}`);
    try {
      const response = await fetch(`${base}/api/dashboard`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
    } catch {
      // The child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Web server did not start:\n${output}`);
}

async function post(path, payload) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Diet-User-Id": "web_smoke_user" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

async function chatEvents(payload) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Diet-User-Id": "web_smoke_user" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`chat replay returned HTTP ${response.status}`);
  const body = await response.text();
  return body.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

function assertStatus(result, expected, label) {
  if (result.status !== expected) throw new Error(`${label}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.body)}`);
}

try {
  const initial = await waitForServer();
  for (const asset of ["/app.js", "/chatController.js", "/recoveryStore.js", "/planDialog.js"]) {
    const response = await fetch(`${base}${asset}`);
    if (!response.ok || !response.headers.get("content-type")?.includes("javascript")) {
      throw new Error(`Frontend module not served correctly: ${asset}`);
    }
  }
  const profileId = "web-smoke-profile-123";
  const profile = { updatedAt: initial.profile?.updatedAt ?? "", goal: "maintain", avoidFoods: [], allergies: [], preferences: [], medicalNotes: [] };
  const missingId = await post("/api/profile", profile);
  assertStatus(missingId, 400, "missing operation ID");
  if (!missingId.body.error?.includes("operationId")) throw new Error("Missing operation ID was not the reason for rejection");
  assertStatus(await post("/api/profile", { ...profile, operationId: profileId }), 200, "profile save");
  assertStatus(await post("/api/profile", { operationId: profileId, ...profile }), 200, "same request replay");
  assertStatus(await post("/api/profile", { ...profile, goal: "fat_loss", operationId: profileId }), 409, "reused ID with changed body");
  assertStatus(await post("/api/profile", { ...profile, allergies: ["花生"], operationId: "web-smoke-profile-stale" }), 409, "stale profile save");
  const afterProfile = await (await fetch(`${base}/api/dashboard`)).json();
  assertStatus(await post("/api/profile", { ...profile, updatedAt: afterProfile.profile.updatedAt, allergies: ["花生"], operationId: "web-smoke-profile-2" }), 200, "current profile save");
  const replayedProfile = await post("/api/profile", { operationId: profileId, ...profile });
  assertStatus(replayedProfile, 200, "profile replay with current dashboard");
  if (replayedProfile.body.data.profile.allergies.join(",") !== "花生") throw new Error("Replayed write returned a stale dashboard");

  const kitchen = { updatedAt: initial.kitchen.updatedAt, burners: 1 };
  assertStatus(await post("/api/kitchen", { ...kitchen, operationId: "web-smoke-kitchen-1" }), 200, "kitchen save");
  assertStatus(await post("/api/kitchen", { ...kitchen, burners: 2, operationId: "web-smoke-kitchen-stale" }), 409, "stale kitchen save");

  const firstInventory = await post("/api/inventory", {
    operationId: "web-smoke-inventory-1", updatedAt: initial.inventory.updatedAt,
    availableIngredients: [{ name: "番茄" }], shoppingList: [],
  });
  assertStatus(firstInventory, 200, "initial inventory save");
  assertStatus(await post("/api/inventory", {
    operationId: "web-smoke-inventory-2", updatedAt: initial.inventory.updatedAt,
    availableIngredients: [{ name: "鸡蛋" }], shoppingList: [],
  }), 409, "stale inventory save");
  const current = await (await fetch(`${base}/api/dashboard`)).json();
  if (current.inventory.availableIngredients.map((item) => item.name).join(",") !== "番茄") {
    throw new Error("Stale inventory request changed saved data");
  }
  const db = new Database(join(directory, "data.sqlite"));
  claimChatOperation(db, "web_smoke_user", "web-smoke-chat-done", "已完成请求", false);
  finishChatOperation(db, "web_smoke_user", "web-smoke-chat-done", {
    type: "done", status: "done", reply: "已保存的回复",
  });
  claimChatOperation(db, "web_smoke_user", "web-smoke-chat-running", "未完成请求", false);
  db.close();
  const doneEvents = await chatEvents({ operationId: "web-smoke-chat-done", message: "已完成请求" });
  if (doneEvents.length !== 1 || doneEvents[0].type !== "done" || doneEvents[0].reply !== "已保存的回复") {
    throw new Error(`Completed chat did not replay its saved result: ${JSON.stringify(doneEvents)}`);
  }
  const uncertainEvents = await chatEvents({ operationId: "web-smoke-chat-running", message: "未完成请求", retry: true });
  if (uncertainEvents.length !== 1 || uncertainEvents[0].type !== "result_uncertain") {
    throw new Error(`Unfinished chat was restarted unexpectedly: ${JSON.stringify(uncertainEvents)}`);
  }
  console.log("Web smoke passed: write IDs, profile and kitchen conflicts, current replay data, inventory conflicts, and saved chat outcomes checked over HTTP.");
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  rmSync(directory, { recursive: true, force: true });
}
