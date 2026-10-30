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

const startServer = () => spawn(process.execPath, ["dist/web/index.js", "web_smoke_user"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DIET_AGENT_DB_PATH: join(directory, "data.sqlite"),
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let child = startServer();
let output = "";
let startupError;
function captureOutput() {
  child.once("error", error => { startupError = error; });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
}
captureOutput();
const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Web server exited early:\n${output}`);
    try {
      const response = await fetch(`${base}/api/dashboard`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
    } catch {
      // The child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
  for (const asset of ["/app.js", "/chatController.js", "/recoveryStore.js", "/planDialog.js", "/shoppingView.js", "/cartExperimentView.js"]) {
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
  const planned = await post("/api/inventory/items", {operationId:"shopping-smoke-planned",name:"菠菜",amount:"1 把",storage:"fridge",status:"planned"});
  assertStatus(planned, 201, "shopping planned ingredient");
  const purchase = await post("/api/shopping/tasks", {operationId:"shopping-smoke-create",provider:"meituan",inventoryUpdatedAt:planned.body.inventory.updatedAt,items:[{sourceItemId:planned.body.item.id}]});
  assertStatus(purchase, 201, "shopping create");
  const task = purchase.body.task;
  assertStatus(await post(`/api/shopping/tasks/${task.id}/mark-ordered`, {operationId:"shopping-smoke-ordered",expectedVersion:task.version,itemIds:[task.items[0].id]}), 200, "shopping record order");
  const unreceived = await (await fetch(`${base}/api/dashboard`)).json();
  if (unreceived.inventory.availableIngredients.some(item => item.name === "菠菜")) throw new Error("Unreceived purchase entered inventory");
  const receivePayload = {operationId:"shopping-smoke-receive",expectedVersion:2,inventoryUpdatedAt:unreceived.inventory.updatedAt,items:[{itemId:task.items[0].id,name:"菠菜",amount:"1 把",storage:"fridge",complete:true}]};
  const received = await post(`/api/shopping/tasks/${task.id}/receive`, receivePayload);
  assertStatus(received, 200, "shopping receive");
  assertStatus(await post(`/api/shopping/tasks/${task.id}/receive`, receivePayload), 200, "shopping receive replay");
  const afterReceive = await (await fetch(`${base}/api/dashboard`)).json();
  if (afterReceive.inventory.availableIngredients.filter(item => item.name === "菠菜").length !== 1 || received.body.task.status !== "completed") throw new Error("Shopping receipt replay duplicated inventory");

  const cartPlanned = await post("/api/inventory/items", {operationId:"cart-smoke-planned",name:"牛奶",amount:"1 升",status:"planned"});
  assertStatus(cartPlanned,201,"cart experiment ingredient");
  const cartTask = await post("/api/shopping/tasks",{operationId:"cart-smoke-task",provider:"taobao",inventoryUpdatedAt:cartPlanned.body.inventory.updatedAt,items:[{sourceItemId:cartPlanned.body.item.id}]});
  assertStatus(cartTask,201,"cart experiment task");
  const createdCart = await post("/api/shopping/cart-experiments",{operationId:"cart-smoke-create",taskId:cartTask.body.task.id,expectedTaskVersion:1,itemIds:[cartTask.body.task.items[0].id],phoneOS:"ios",store:"测试超市",accountLabel:"测试账号"});
  assertStatus(createdCart,201,"cart experiment create");
  let experiment = createdCart.body.experiment;
  const cartAction = async (action,payload) => post(`/api/shopping/cart-experiments/${experiment.id}/${action}`,{operationId:`cart-smoke-${action}`,expectedVersion:experiment.version,contextConfirmed:true,completeCartConfirmed:true,...payload});
  experiment = (await cartAction("baseline",{cart:[]})).body.experiment;
  experiment = (await cartAction("select",{itemId:cartTask.body.task.items[0].id,store:"测试超市",title:"牛奶",specification:"1 升/盒",quantity:1,priceCents:990,specificationConfirmed:true,availableConfirmed:true})).body.experiment;
  experiment = (await cartAction("prepare",{})).body.experiment;
  const cartBegin = {operationId:"cart-smoke-begin-step",expectedVersion:experiment.version,contextConfirmed:true,completeCartConfirmed:true,cart:[],stepId:experiment.steps[0].id};
  assertStatus(await post(`/api/shopping/cart-experiments/${experiment.id}/begin-step`,cartBegin),200,"register cart step before restart");

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
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  await exited;
  child = startServer(); output = ""; startupError = undefined; captureOutput();
  await waitForServer();
  assertStatus(await post(`/api/shopping/tasks/${task.id}/receive`, receivePayload), 200, "shopping receive replay after restart");
  const restarted = await (await fetch(`${base}/api/dashboard`)).json();
  if (restarted.inventory.availableIngredients.filter(item => item.name === "菠菜").length !== 1) throw new Error("Restart replay duplicated shopping receipt");
  const cartReplay = await post(`/api/shopping/cart-experiments/${experiment.id}/begin-step`,cartBegin);
  assertStatus(cartReplay,200,"cart step replay after restart");
  const recoveredCart = restarted.shopping.cartExperiments.find(e => e.id === experiment.id);
  if (recoveredCart?.status !== "awaiting_reconciliation" || recoveredCart.events.filter(e => e.type === "manual_step_registered_before_phone_action").length !== 1) throw new Error("Cart step was lost or repeated after restart");
  const repeatStep = await post(`/api/shopping/cart-experiments/${experiment.id}/begin-step`,{...cartBegin,operationId:"cart-smoke-unsafe-repeat",expectedVersion:recoveredCart.version});
  assertStatus(repeatStep,422,"refuse a fresh repeat of unresolved cart step");
  console.log("Web smoke passed: writes, shopping receipt and cart-step replay across restart, and saved chat outcomes checked over HTTP.");
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  rmSync(directory, { recursive: true, force: true });
}
