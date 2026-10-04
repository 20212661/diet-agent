import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

import { GLM_STRICT_COOKING_AGENT_PROMPT, buildUserMemoryPrompt } from "./systemPrompt.js";
import * as sessionStore from "./sessionStore.js";
import {
  resolveModelCandidates,
  shouldFallbackToCandidate,
  wrapToolsForUser,
  type ModelCandidate,
} from "./modelAdapter.js";
import { PROVIDER_CONFIGS } from "./modelProviders.js";
import { setActiveUserMessage } from "../utils/userTurnContext.js";
import * as store from "../store/index.js";
import { generateCookingPlanTool } from "../tools/generateCookingPlan.js";
import { generateMealPlanTool } from "../tools/generateMealPlan.js";
import { getMealPlanTool } from "../tools/getMealPlan.js";
import { generateWeeklyPlanTool } from "../tools/generateWeeklyPlan.js";
import { getWeeklyPlanTool } from "../tools/getWeeklyPlan.js";
import { getIngredientInventoryTool } from "../tools/getIngredientInventory.js";
import { getKitchenProfileTool } from "../tools/getKitchenProfile.js";
import { getTodaySummaryTool } from "../tools/getTodaySummary.js";
import { getUserProfileTool } from "../tools/getUserProfile.js";
import { logCookingFeedbackTool } from "../tools/logCookingFeedback.js";
import { logMealTool } from "../tools/logMeal.js";
import { estimateFoodCaloriesTool } from "../tools/estimateFoodCalories.js";
import { searchNutritionFoodsTool } from "../tools/searchNutritionFoods.js";
import { editMealLogTool } from "../tools/editMealLog.js";
import { undoMealLogTool } from "../tools/undoMealLog.js";
import { markIngredientUsedTool } from "../tools/markIngredientUsed.js";
import { searchRecipesTool } from "../tools/searchRecipes.js";
import { updateIngredientInventoryTool } from "../tools/updateIngredientInventory.js";
import { updateKitchenProfileTool } from "../tools/updateKitchenProfile.js";
import { updateUserProfileTool } from "../tools/updateUserProfile.js";

export const dietAgentTools = [
  logMealTool,
  estimateFoodCaloriesTool,
  searchNutritionFoodsTool,
  editMealLogTool,
  undoMealLogTool,
  getTodaySummaryTool,
  updateUserProfileTool,
  getUserProfileTool,
  generateMealPlanTool,
  getMealPlanTool,
  generateWeeklyPlanTool,
  getWeeklyPlanTool,
  getKitchenProfileTool,
  updateKitchenProfileTool,
  getIngredientInventoryTool,
  updateIngredientInventoryTool,
  markIngredientUsedTool,
  searchRecipesTool,
  generateCookingPlanTool,
  logCookingFeedbackTool,
];

let modelRuntimePromise: Promise<ModelRuntime> | undefined;
const sessionMemoryByInstance = new WeakMap<AgentSession, string>();

export { getSessionDirForUser } from "./persistentSession.js";
import { getSessionDirForUser, restoreSessionManager } from "./persistentSession.js";

async function getOrCreateSession(userId: string, candidate: ModelCandidate) {
  const memoryPrompt = buildUserMemoryPrompt(userId);
  const existing = sessionStore.getSession(userId);
  if (existing && sessionStore.getSessionModelKey(userId) === candidate.key) {
    if (sessionMemoryByInstance.get(existing) === memoryPrompt) return existing;
    // A web form or another app may update saved context while this session is answering.
    // Let the active turn finish; the next turn will rebuild from the saved transcript.
    if (existing.isStreaming) return existing;
  }

  if (existing) {
    sessionStore.deleteSession(userId);
  }

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const modelRuntime = await getConfiguredModelRuntime();
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
      GLM_STRICT_COOKING_AGENT_PROMPT,
      candidate.promptPatch,
      memoryPrompt,
      [
        "## 当前用户 ID",
        `当前用户 ID 是：${userId}`,
        `所有工具调用的 userId 必须严格使用：${userId}`,
      ].join("\n"),
    ].join("\n\n"),
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const createOpts: CreateAgentSessionOptions = {
    cwd,
    agentDir,
    modelRuntime,
    resourceLoader,
    // 按 userId 隔离的持久化会话：历史存为 JSONL 文件，重启后自动恢复。
    // fallback 切换模型时会重建 session，但复用同一 sessionDir，对话历史不丢。
    sessionManager: restoreSessionManager(cwd, getSessionDirForUser(userId), existing?.sessionManager),
    settingsManager,
    noTools: "builtin",
    customTools: wrapToolsForUser(userId, dietAgentTools),
    ...(candidate.model ? { model: candidate.model } : {}),
  };

  const { session } = await createAgentSession(createOpts);
  sessionMemoryByInstance.set(session, memoryPrompt);
  sessionStore.setSession(userId, session, candidate.key);
  console.log(`[MODEL] user=${userTag(userId)} session=${session.sessionId} model=${candidate.label}`);
  return session;
}

export interface DietAgentResult {
  userId: string;
  reply: string;
  sessionId: string;
  status?: "completed" | "verification_required";
  refreshedData?: Record<string, unknown>;
}

export interface DietAgentSendOptions {
  /** Stable ID generated by the caller for this user initiated operation. */
  operationId?: string;
  /** 每次收到模型文本增量时回调当前完整文本，用于 TUI 流式刷新。 */
  onTextDelta?: (text: string) => void;
  /** 工具操作生命周期只返回状态码，不含参数值或敏感结果。 */
  onToolStatus?: (status: { toolName: string; phase: "pending" | "success" | "error"; outcome?: string }) => void;
}

export async function getConfiguredModelRuntime(): Promise<ModelRuntime> {
  if (!modelRuntimePromise) {
    modelRuntimePromise = (async () => {
      // SDK 0.87 默认读取 ~/.pi/agent/auth.json。此应用的凭据来自 .env，
      // 因此使用进程内 credential store，既避免缺失 auth.json，也不会持久化 Key。
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(),
        refreshOnCreate: false,
      });
      for (const { id: provider, apiKeyEnv } of PROVIDER_CONFIGS) {
        const key = process.env[apiKeyEnv];
        if (key?.trim()) await runtime.setRuntimeApiKey(provider, key.trim());
      }
      return runtime;
    })();
  }
  return modelRuntimePromise;
}

export interface AgentSessionLike {
  sessionId: string;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(message: string, options: { streamingBehavior: "followUp" }): Promise<unknown>;
}

interface AgentLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface DietAgentDispatcherDeps {
  resolveCandidates: () => ModelCandidate[];
  getSession: (userId: string, candidate: ModelCandidate) => Promise<AgentSessionLike>;
  resetSession: (userId: string) => void;
  shouldFallback: (error: unknown, failed: ModelCandidate, next?: ModelCandidate) => boolean;
  getMaxAttempts: (candidateCount: number) => number;
  refreshAfterWrite: (userId: string, toolNames: string[]) => Record<string, unknown>;
  logger: AgentLogger;
}

const WRITE_TOOLS = new Set([
  "log_meal", "edit_meal_log", "undo_meal_log", "update_user_profile", "update_kitchen_profile",
  "update_ingredient_inventory", "mark_ingredient_used", "generate_meal_plan", "generate_weekly_plan",
  "log_cooking_feedback", "generate_cooking_plan",
]);

export class WriteNeedsVerificationError extends Error {
  constructor(
    message: string,
    readonly toolNames: string[],
    readonly sessionId: string,
  ) {
    super(message);
    this.name = "WriteNeedsVerificationError";
  }
}

/** 创建可注入依赖的消息调度器，生产环境和集成测试共用同一套队列/fallback 逻辑。 */
export function createDietAgentDispatcher(
  overrides: Partial<DietAgentDispatcherDeps> = {}
): (userId: string, message: string, options?: DietAgentSendOptions) => Promise<DietAgentResult> {
  const deps: DietAgentDispatcherDeps = {
    resolveCandidates: resolveModelCandidates,
    getSession: getOrCreateSession,
    resetSession: resetUserSession,
    shouldFallback: shouldFallbackToCandidate,
    getMaxAttempts: defaultMaxAttempts,
    refreshAfterWrite: refreshWrittenData,
    logger: console,
    ...overrides,
  };
  const processingMap = new Map<string, Promise<string>>();

  async function sendWithFallback(
    userId: string,
    message: string,
    options?: DietAgentSendOptions
  ): Promise<DietAgentResult> {
    const candidates = deps.resolveCandidates();
    const maxAttempts = Math.min(deps.getMaxAttempts(candidates.length), candidates.length);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = candidates[attempt];
      try {
        const session = await deps.getSession(userId, candidate);
        return await runAgentSessionTurn(session, userId, message, candidate, deps.logger, options);
      } catch (error) {
        lastError = error;
        deps.logger.warn(`[MODEL fallback] user=${userTag(userId)} model=${candidate.label} errorType=${errorType(error)}`);
        deps.resetSession(userId);
        if (error instanceof WriteNeedsVerificationError) {
          const refreshedData = deps.refreshAfterWrite(userId, error.toolNames);
          return {
            userId,
            sessionId: error.sessionId,
            status: "verification_required",
            refreshedData,
            reply: `操作结果需核对：${error.toolNames.join("、")} 可能已执行，但模型未能完成回复。我已重新读取相关数据，请核对后再决定是否重试。`,
          };
        }
        if (!deps.shouldFallback(error, candidate, candidates[attempt + 1]) || attempt >= maxAttempts - 1) break;
        deps.logger.warn("[MODEL fallback] retrying with next candidate...");
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return async (userId: string, message: string, options?: DietAgentSendOptions): Promise<DietAgentResult> => {
    const previous = processingMap.get(userId) ?? Promise.resolve("");
    const current = previous.then(() => sendWithFallback(userId, message, options));
    // 队列 Promise 自己必须消费 rejected 状态，避免调用方 catch 后仍触发
    // unhandledRejection（Windows Node 上曾进一步触发 UV assertion）。
    const queued = current.then((result) => result.reply, () => "");
    processingMap.set(userId, queued);

    try {
      return await current;
    } finally {
      if (processingMap.get(userId) === queued) processingMap.delete(userId);
    }
  };
}

export const sendDietAgentMessage = createDietAgentDispatcher();

export async function runAgentSessionTurn(
  session: AgentSessionLike,
  userId: string,
  message: string,
  candidate: ModelCandidate,
  logger: AgentLogger = console,
  options?: DietAgentSendOptions
): Promise<DietAgentResult> {
  // pi-coding-agent 的 message_update 事件中，最终消息在
  // assistantMessageEvent/agent_end.messages 里；event.message 只是当前快照，
  // 在某些 provider（尤其 OpenAI-compatible DeepSeek）上快照的 text content
  // 仍为空，不能只依赖它来判断是否有回复。
  let streamedReply = "";
  let finalReply = "";
  let toolHadError = false;
  const successfulWriteTools = new Set<string>();
  const possibleWriteTools = new Set<string>();
  const uncertainWriteTools = new Set<string>();
  let modelError = "";
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === "text_delta") {
        streamedReply += assistantEvent.delta;
        options?.onTextDelta?.(streamedReply);
      }
    }

    if (event.type === "tool_execution_start") {
      if (WRITE_TOOLS.has(event.toolName)) possibleWriteTools.add(event.toolName);
      logger.log(`[TOOL start] user=${userTag(userId)} model=${candidate.label} tool=${event.toolName} args=omitted`);
      options?.onToolStatus?.({ toolName: event.toolName, phase: "pending" });
    }

    if (event.type === "tool_execution_end") {
      toolHadError = toolHadError || event.isError;
      if (WRITE_TOOLS.has(event.toolName)) {
        possibleWriteTools.delete(event.toolName);
        if (event.isError) uncertainWriteTools.add(event.toolName);
        else if (toolResultIndicatesSuccess(event.result)) successfulWriteTools.add(event.toolName);
      }
      const outcome = safeToolOutcome(event.result, event.isError);
      logger.log(`[TOOL end] user=${userTag(userId)} model=${candidate.label} tool=${event.toolName} outcome=${outcome}`);
      options?.onToolStatus?.({ toolName: event.toolName, phase: event.isError ? "error" : "success", outcome });
    }

    if (event.type === "agent_end") {
      const replyFromMessages = extractLastAssistantText(event.messages);
      if (replyFromMessages) finalReply = replyFromMessages;
      const errorFromMessages = extractLastAssistantError(event.messages);
      if (errorFromMessages) modelError = errorFromMessages;
      // agent_end 也会在 SDK 自动重试前触发；不能在 willRetry=true 时
      // 提前结束等待，否则会把一次正常的自动重试误报为“无回复”。
      if (!event.willRetry) resolveDone();
    }
  });

  const clearActiveMessage = setActiveUserMessage(userId, message, options?.operationId);
  let promptError: unknown;
  try {
    await session.prompt(message, { streamingBehavior: "followUp" });
    await donePromise;
  } catch (error) {
    promptError = error;
  } finally {
    clearActiveMessage();
    unsubscribe();
  }

  if (promptError !== undefined) {
    const writesToCheck = [...new Set([...successfulWriteTools, ...possibleWriteTools, ...uncertainWriteTools])];
    if (writesToCheck.length > 0) {
      throw new WriteNeedsVerificationError(
        errorText(promptError), writesToCheck, session.sessionId,
      );
    }
    throw promptError;
  }

  if (uncertainWriteTools.size > 0) {
    throw new WriteNeedsVerificationError(
      "写入工具返回错误，无法确认是否已部分保存。",
      [...new Set([...successfulWriteTools, ...uncertainWriteTools])],
      session.sessionId,
    );
  }

  const fullReply = (finalReply || streamedReply).trim();
  if (!fullReply) {
    if (modelError) {
      const error = new Error(`模型请求失败（${candidate.label}）：${modelError}`);
      const writesToCheck = [...new Set([...successfulWriteTools, ...possibleWriteTools, ...uncertainWriteTools])];
      if (writesToCheck.length > 0) {
        throw new WriteNeedsVerificationError(error.message, writesToCheck, session.sessionId);
      }
      throw error;
    }
    const error = new Error(toolHadError ? "Agent produced no text after tool error." : "Agent produced no text reply.");
    const writesToCheck = [...new Set([...successfulWriteTools, ...possibleWriteTools, ...uncertainWriteTools])];
    if (writesToCheck.length > 0) {
      throw new WriteNeedsVerificationError(error.message, writesToCheck, session.sessionId);
    }
    throw error;
  }

  return {
    userId,
    reply: fullReply,
    sessionId: session.sessionId,
  };
}

function toolResultIndicatesSuccess(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return true;
  const outcome = details as Record<string, unknown>;
  return outcome.saved !== false && outcome.undone !== false && outcome.clarificationRequired !== true && outcome.notFound !== true
    && outcome.status !== "no_match";
}

function refreshWrittenData(userId: string, toolNames: string[]): Record<string, unknown> {
  const tools = new Set(toolNames);
  const refreshed: Record<string, unknown> = {};
  if (["update_user_profile"].some((name) => tools.has(name))) refreshed.userProfile = store.getUserProfile(userId);
  if (["update_kitchen_profile"].some((name) => tools.has(name))) refreshed.kitchenProfile = store.getKitchenProfile(userId);
  if (["update_ingredient_inventory", "mark_ingredient_used", "generate_cooking_plan"].some((name) => tools.has(name))) {
    refreshed.inventory = store.getIngredientInventory(userId);
  }
  if (["log_meal", "edit_meal_log", "undo_meal_log"].some((name) => tools.has(name))) {
    refreshed.mealLogs = store.getAllMealLogs(userId);
  }
  if (tools.has("generate_meal_plan")) refreshed.mealPlan = store.getMealPlan(userId);
  if (tools.has("generate_weekly_plan")) refreshed.weeklyPlan = store.getWeeklyPlan(userId);
  if (tools.has("log_cooking_feedback")) refreshed.cookingFeedback = store.getCookingFeedback(userId);
  return refreshed;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 从 agent_end 的完整消息列表中提取最后一条 assistant 文本。 */
export function extractLastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant" || !Array.isArray(record.content)) continue;

    const text = record.content
      .filter((block): block is Record<string, unknown> => !!block && typeof block === "object")
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (text.trim()) return text;
  }

  return "";
}

/** 从 agent_end 的完整消息列表中提取最后一条 assistant 的 provider 错误。 */
export function extractLastAssistantError(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    if (typeof record.errorMessage === "string" && record.errorMessage.trim()) {
      return record.errorMessage.trim();
    }
  }

  return "";
}

export async function getUserSession(userId: string) {
  const candidate = resolveModelCandidates()[0];
  return getOrCreateSession(userId, candidate);
}

function resetUserSession(userId: string) {
  sessionStore.deleteSession(userId);
}

export function clearUserAgentSession(userId: string): void {
  resetUserSession(userId);
  const directory = getSessionDirForUser(userId);
  // getSessionDirForUser is a SHA-256-derived child of SESSIONS_ROOT, never raw user input.
  rmSync(directory, { recursive: true, force: true });
}

export function disposeAllAgentSessions(): void {
  sessionStore.disposeAllSessions();
}

function defaultMaxAttempts(candidateCount: number): number {
  const configured = Number(process.env.MODEL_FALLBACK_ATTEMPTS ?? String(candidateCount));
  return Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : candidateCount;
}

function userTag(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 12);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function safeToolOutcome(result: unknown, isError: boolean): string {
  if (isError) return "error";
  if (!result || typeof result !== "object") return "completed";
  const top = result as Record<string, unknown>;
  const detail = top.details && typeof top.details === "object" ? top.details as Record<string, unknown> : top;
  const status = detail.status === "matched" || detail.status === "no_match" ? `status=${detail.status}` : "";
  const flags = ["saved", "cancelled", "confirmationRequired", "clarificationRequired", "undone", "notFound"]
    .filter((key) => typeof detail[key] === "boolean")
    .map((key) => `${key}=${String(detail[key])}`);
  return [status, ...flags].filter(Boolean).join(",") || "completed";
}
