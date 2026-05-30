import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DIET_AGENT_CORE_PROMPT, buildUserMemoryPrompt, buildUserRecipesPrompt, buildCurrentUserIdPrompt } from "./systemPrompt.js";
import { buildSkillIndexPrompt } from "../skills/index.js";
import * as sessionStore from "./sessionStore.js";
import * as store from "../store/index.js";
import {
  resolveModelCandidates,
  shouldFallbackModel,
  wrapToolsForUser,
  type ModelCandidate,
} from "./modelAdapter.js";
import { generateCookingPlanTool } from "../tools/generateCookingPlan.js";
import { generateMealPlanTool } from "../tools/generateMealPlan.js";
import { getIngredientInventoryTool } from "../tools/getIngredientInventory.js";
import { getKitchenProfileTool } from "../tools/getKitchenProfile.js";
import { getTodaySummaryTool } from "../tools/getTodaySummary.js";
import { getUserProfileTool } from "../tools/getUserProfile.js";
import { logCookingFeedbackTool } from "../tools/logCookingFeedback.js";
import { logMealTool } from "../tools/logMeal.js";
import { markIngredientUsedTool } from "../tools/markIngredientUsed.js";
import { searchRecipesTool } from "../tools/searchRecipes.js";
import { updateIngredientInventoryTool } from "../tools/updateIngredientInventory.js";
import { updateKitchenProfileTool } from "../tools/updateKitchenProfile.js";
import { updateUserProfileTool } from "../tools/updateUserProfile.js";
import { searchFoodApiTool } from "../tools/searchFoodApi.js";
import { getSkillTool } from "../tools/getSkill.js";

const baseCustomTools = [
  logMealTool,
  getTodaySummaryTool,
  updateUserProfileTool,
  getUserProfileTool,
  generateMealPlanTool,
  getKitchenProfileTool,
  updateKitchenProfileTool,
  getIngredientInventoryTool,
  updateIngredientInventoryTool,
  markIngredientUsedTool,
  searchRecipesTool,
  generateCookingPlanTool,
  logCookingFeedbackTool,
  searchFoodApiTool,
  getSkillTool,
];

const processingMap = new Map<string, Promise<string>>();
const sessionModelKeyMap = new Map<string, string>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSIONS_ROOT = join(__dirname, "..", "..", "data", "sessions");

function getUserSessionDir(userId: string): string {
  const safeName = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = join(SESSIONS_ROOT, safeName);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function getOrCreateSession(userId: string, candidate: ModelCandidate) {
  const existing = sessionStore.getSession(userId);
  if (existing && sessionModelKeyMap.get(userId) === candidate.key) {
    return existing;
  }

  if (existing) {
    disposeSession(existing);
    sessionStore.deleteSession(userId);
  }

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(agentDir);
  const modelRegistry = ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => [
      DIET_AGENT_CORE_PROMPT,
      buildSkillIndexPrompt(),
      buildUserMemoryPrompt(userId),
      buildUserRecipesPrompt(userId),
      buildCurrentUserIdPrompt(userId),
    ].filter(Boolean).join("\n\n"),
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const createOpts: CreateAgentSessionOptions = {
    cwd,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.continueRecent(cwd, getUserSessionDir(userId)),
    settingsManager,
    noTools: "builtin",
    customTools: wrapToolsForUser(userId, baseCustomTools),
    ...(candidate.model ? { model: candidate.model } : {}),
  };

  const { session } = await createAgentSession(createOpts);
  sessionStore.setSession(userId, session);
  sessionModelKeyMap.set(userId, candidate.key);
  console.log(`[MODEL] userId=${userId} session=${session.sessionId} model=${candidate.label}`);
  return session;
}

export async function sendDietAgentMessage(
  userId: string,
  message: string
): Promise<{ userId: string; reply: string; sessionId: string }> {
  const prevPromise = processingMap.get(userId) ?? Promise.resolve("");
  const currentPromise = prevPromise.then(() => doSendWithFallback(userId, message));
  const queuePromise = currentPromise.then((result) => result.reply);
  processingMap.set(userId, queuePromise);

  try {
    return await currentPromise;
  } finally {
    if (processingMap.get(userId) === queuePromise) {
      processingMap.delete(userId);
    }
  }
}

async function doSendWithFallback(
  userId: string,
  message: string
): Promise<{ userId: string; reply: string; sessionId: string }> {
  const candidates = resolveModelCandidates();
  const maxAttempts = Math.max(1, Number(process.env.MODEL_FALLBACK_ATTEMPTS ?? "2"));
  let lastError: unknown;

  for (let attempt = 0; attempt < Math.min(maxAttempts, candidates.length); attempt++) {
    const candidate = candidates[attempt];
    try {
      const result = await doSend(userId, message, candidate);
      store.saveChatMessage(userId, "user", message);
      store.saveChatMessage(userId, "assistant", result.reply);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[MODEL fallback] userId=${userId} model=${candidate.label} failed: ${errorText(err)}`);
      resetUserSession(userId);
      if (!shouldFallbackModel(err) || attempt >= maxAttempts - 1) break;
      console.warn(`[MODEL fallback] retrying with next candidate...`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function doSend(
  userId: string,
  message: string,
  candidate: ModelCandidate
): Promise<{ userId: string; reply: string; sessionId: string }> {
  const session = await getOrCreateSession(userId, candidate);
  let fullReply = "";
  let toolHadError = false;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const msg = event.message;
      if ("role" in msg && msg.role === "assistant" && "content" in msg && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("type" in block && block.type === "text" && "text" in block) {
            fullReply = block.text;
          }
        }
      }
    }

    if (event.type === "tool_execution_start") {
      console.log(`[TOOL start] userId=${userId} model=${candidate.label} tool=${event.toolName} args=${safeJsonPreview(event.args)}`);
    }

    if (event.type === "tool_execution_end") {
      toolHadError = toolHadError || event.isError;
      console.log(`[TOOL end] userId=${userId} model=${candidate.label} tool=${event.toolName} isError=${event.isError} result=${safeJsonPreview(event.result)}`);
    }

    if (event.type === "agent_end") {
      resolveDone();
    }
  });

  try {
    await session.prompt(message, { streamingBehavior: "followUp" });
    await donePromise;
  } finally {
    unsubscribe();
  }

  if (!fullReply.trim()) {
    throw new Error(toolHadError ? "Agent produced no text after tool error." : "Agent produced no text reply.");
  }

  return {
    userId,
    reply: fullReply,
    sessionId: session.sessionId,
  };
}

export async function getUserSession(userId: string) {
  const candidate = resolveModelCandidates()[0];
  return getOrCreateSession(userId, candidate);
}

function resetUserSession(userId: string) {
  const existing = sessionStore.getSession(userId);
  if (existing) disposeSession(existing);
  sessionStore.deleteSession(userId);
  sessionModelKeyMap.delete(userId);
}

function disposeSession(session: AgentSession) {
  try {
    session.dispose();
  } catch {
    // Best-effort cleanup only.
  }
}

function safeJsonPreview(value: unknown, maxLength = 500): string {
  if (value === undefined) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "[unserializable]";
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
