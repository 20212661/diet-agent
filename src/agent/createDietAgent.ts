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
  classifyModelError,
  fenceUserTools,
  resolveModelCandidates,
  shouldFallbackToCandidate,
  wrapToolsForUser,
  type ModelCandidate,
} from "./modelAdapter.js";
import {
  createTurnGuard,
  loadRequestDeadlineMs,
  loadTurnLimits,
  sleep,
  TurnLimitError,
  type TurnLimits,
} from "./turnGuard.js";
import { createTraceRecorder, type TraceEntry, type TraceRecorder } from "./traceRecorder.js";
import {
  safeToolOutcome,
  toolResultIndicatesSuccess,
  toolResultIndicatesUnconfirmed,
  WRITE_TOOLS,
} from "./toolOutcomes.js";
import type { TraceStatus } from "../store/repositories/traceRepository.js";
import { PROVIDER_CONFIGS } from "./modelProviders.js";
import { setActiveUserMessage, detectUnsavedMealClaim, MEAL_CLAIM_UNSAVED_NOTICE, currentDateTimeContext } from "../utils/userTurnContext.js";
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
import { getShoppingTasksTool, createShoppingTaskTool } from "../tools/shopping.js";
import { listShoppingTasks } from "../shopping/shoppingService.js";

export const dietAgentTools = [
  getShoppingTasksTool,
  createShoppingTaskTool,
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

/**
 * bench 诊断用：getOrCreateSession 每次调用的判定结果计数。
 * 只在既有分支上加一次 Map 计数，不改任何会话行为；用于回答
 * "写操作之后到底有没有重建 session"——sessionId 与 [MODEL] 日志
 * 都不能可靠反映重建（restoreSessionManager 复用会话文件时
 * sessionId 可能不变）。
 */
export type SessionResolution =
  | "created_fresh" // 无既有 session，新建
  | "reused_unchanged" // 记忆未变，直接复用
  | "reused_streaming" // 记忆已变，但上一轮仍在输出，暂复用旧 session（下一轮再重建）
  | "rebuilt_memory" // 用户记忆变化触发重建
  | "rebuilt_model"; // 候选模型变化触发重建
const sessionResolutionCounts = new Map<SessionResolution, number>();

export function getSessionResolutionCounts(): ReadonlyMap<SessionResolution, number> {
  return new Map(sessionResolutionCounts);
}

export function resetSessionResolutionCounts(): void {
  sessionResolutionCounts.clear();
}

function recordSessionResolution(kind: SessionResolution): void {
  sessionResolutionCounts.set(kind, (sessionResolutionCounts.get(kind) ?? 0) + 1);
}

export { getSessionDirForUser } from "./persistentSession.js";
import { getSessionDirForUser, restoreSessionManager } from "./persistentSession.js";

async function getOrCreateSession(userId: string, candidate: ModelCandidate) {
  const memoryPrompt = buildUserMemoryPrompt(userId);
  const existing = sessionStore.getSession(userId);
  const modelKeyMatches = sessionStore.getSessionModelKey(userId) === candidate.key;
  if (existing && modelKeyMatches) {
    if (sessionMemoryByInstance.get(existing) === memoryPrompt) {
      recordSessionResolution("reused_unchanged");
      return existing;
    }
    // A web form or another app may update saved context while this session is answering.
    // Let the active turn finish; the next turn will rebuild from the saved transcript.
    if (existing.isStreaming) {
      recordSessionResolution("reused_streaming");
      return existing;
    }
  }

  if (existing) {
    recordSessionResolution(modelKeyMatches ? "rebuilt_memory" : "rebuilt_model");
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
  recordSessionResolution("created_fresh");
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
  /** 请求来源，用于 trace 区分 web / tui / eval；默认 web。 */
  entry?: TraceEntry;
  /** 每次收到模型文本增量时回调当前完整文本，用于 TUI 流式刷新。 */
  onTextDelta?: (text: string) => void;
  /** 工具操作生命周期只返回状态码，不含参数值或敏感结果。 */
  onToolStatus?: (status: { toolName: string; phase: "pending" | "success" | "error"; outcome?: string }) => void;
  /** 原始会话事件转发（trace recorder 使用），事件对象不含用户消息内容本身。 */
  onSessionEvent?: (event: AgentSessionEvent) => void;
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
  /** SDK AgentSession 自带；测试用的假 session 可以不实现。 */
  abort?(): Promise<void>;
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
  createTracer?: (context: { userId: string; operationId?: string; entry: TraceEntry }) => TraceRecorder;
  loadTurnLimits?: () => TurnLimits;
  loadRequestDeadlineMs?: () => number;
}

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
    createTracer: (context) => createTraceRecorder(context),
    loadTurnLimits: () => loadTurnLimits(),
    loadRequestDeadlineMs: () => loadRequestDeadlineMs(),
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
    const baseLimits = deps.loadTurnLimits!();
    const requestDeadlineMs = deps.loadRequestDeadlineMs!();
    const requestStartedAt = Date.now();
    const tracer = deps.createTracer!({
      userId,
      operationId: options?.operationId,
      entry: options?.entry ?? "web",
    });
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = candidates[attempt];
      // 请求级截止时间：每次降级尝试只能使用剩余额度，避免多个候选各等满单轮超时。
      const remainingMs = requestDeadlineMs - (Date.now() - requestStartedAt);
      if (remainingMs <= 0) {
        lastError = lastError ?? new TurnLimitError("deadline", Date.now() - requestStartedAt);
        break;
      }
      const turnLimits: TurnLimits = { ...baseLimits, deadlineMs: Math.min(baseLimits.deadlineMs, remainingMs) };
      try {
        const session = await deps.getSession(userId, candidate);
        tracer.beginAttempt(candidate.label, session.sessionId);
        const callerOnSessionEvent = options?.onSessionEvent;
        const callerOnToolStatus = options?.onToolStatus;
        const mealWriteOutcomes: string[] = [];
        const turnOptions: DietAgentSendOptions = {
          ...options,
          onSessionEvent: (event) => {
            tracer.onEvent(event);
            callerOnSessionEvent?.(event);
          },
          onToolStatus: (status) => {
            // 记餐写入必须 saved=true 才算数（clarificationRequired 不算）；
            // 反馈/库存写入成功也算"本轮有落库"，避免"已记录反馈"被误判成记餐声称。
            if (status.phase === "success") {
              if (status.toolName === "log_meal" || status.toolName === "edit_meal_log") {
                mealWriteOutcomes.push(status.outcome ?? "");
              } else if (status.toolName === "log_cooking_feedback" || status.toolName === "update_ingredient_inventory") {
                mealWriteOutcomes.push("saved=true");
              }
            }
            callerOnToolStatus?.(status);
          },
        };
        const result = await runAgentSessionTurn(session, userId, message, candidate, deps.logger, turnOptions, turnLimits);
        // 兜底校验：回复声称已记录但本轮没有任何成功的写入 → 追加提示并记 trace，
        // 不让"口头答应、没写库"静默通过（log_meal 已改为立即记录，这里是第二道防线）。
        if (!mealWriteOutcomes.some((outcome) => outcome.includes("saved=true")) && detectUnsavedMealClaim(result.reply)) {
          result.reply += `\n\n${MEAL_CLAIM_UNSAVED_NOTICE}`;
          tracer.mark("claimed_unsaved", "log_meal");
        }
        tracer.finish("ok");
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof TurnLimitError) tracer.mark("abort", error.reason);
        deps.logger.warn(
          `[MODEL fallback] user=${userTag(userId)} model=${candidate.label} errorType=${errorType(error)}`
          + (error instanceof TurnLimitError ? ` reason=${error.reason}` : "")
        );
        deps.resetSession(userId);
        if (error instanceof WriteNeedsVerificationError) {
          tracer.finish("verification_required");
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
        tracer.mark("fallback", candidates[attempt + 1].label);
        deps.logger.warn("[MODEL fallback] retrying with next candidate...");
      }
    }

    tracer.finish(traceStatusForError(lastError), traceErrorKindFor(lastError));
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

function traceStatusForError(error: unknown): TraceStatus {
  if (error instanceof TurnLimitError) {
    return error.reason === "idle" || error.reason === "deadline" ? "timeout" : "budget_exceeded";
  }
  return "failed";
}

function traceErrorKindFor(error: unknown): string {
  if (error instanceof TurnLimitError) return error.reason;
  if (error instanceof WriteNeedsVerificationError) return "verification_required";
  return classifyModelError(error).kind;
}

/** agent_end 后等待 SDK 收尾（agent_settled）的上限；bench 实测收尾约 50ms。 */
const SETTLE_WAIT_MS = 5_000;

export async function runAgentSessionTurn(
  session: AgentSessionLike,
  userId: string,
  message: string,
  candidate: ModelCandidate,
  logger: AgentLogger = console,
  options?: DietAgentSendOptions,
  limits: TurnLimits = loadTurnLimits(),
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
  let turnLimitError: TurnLimitError | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  // TurnGuard 兜底 provider 挂死：触发后 abort 会话，等待宽限期即结束本轮，
  // 不再依赖 SDK 自己发出 agent_end。同时 fence 该会话的写工具——abort 挂死时
  // SDK 循环可能未停，后续补发的写工具调用必须被拒绝，保证“超时未发生写入”
  // 的承诺成立。
  const guard = createTurnGuard(limits, (error) => {
    turnLimitError = error;
    fenceUserTools(userId);
    logger.warn(
      `[TURN limit] user=${userTag(userId)} model=${candidate.label} reason=${error.reason} elapsedMs=${error.elapsedMs}`
    );
    void (async () => {
      try {
        await Promise.race([
          (async () => session.abort?.())(),
          sleep(limits.abortGraceMs),
        ]);
      } catch {
        // abort 失败也必须放行本轮，不能让队列继续挂着。
      }
      rejectDone(error);
    })();
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    guard.touch();
    options?.onSessionEvent?.(event);

    if (event.type === "message_start") {
      if ((event.message as { role?: unknown } | undefined)?.role === "assistant") guard.onLlmStart();
    }

    if (event.type === "auto_retry_start") {
      guard.onRetryBackoff(event.delayMs);
    }

    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === "text_delta") {
        streamedReply += assistantEvent.delta;
        options?.onTextDelta?.(streamedReply);
      }
    }

    if (event.type === "tool_execution_start") {
      guard.onToolStart();
      if (WRITE_TOOLS.has(event.toolName)) possibleWriteTools.add(event.toolName);
      logger.log(`[TOOL start] user=${userTag(userId)} model=${candidate.label} tool=${event.toolName} args=omitted`);
      options?.onToolStatus?.({ toolName: event.toolName, phase: "pending" });
    }

    if (event.type === "tool_execution_end") {
      toolHadError = toolHadError || event.isError;
      if (WRITE_TOOLS.has(event.toolName)) {
        possibleWriteTools.delete(event.toolName);
        if (event.isError) uncertainWriteTools.add(event.toolName);
        // 写工具超时返回的结构化“未确认”结果：底层调用可能仍在后台完成，
        // 必须按不确定处理，要求人工核对而不是让本轮静默通过。
        else if (toolResultIndicatesUnconfirmed(event.result)) uncertainWriteTools.add(event.toolName);
        else if (toolResultIndicatesSuccess(event.result)) successfulWriteTools.add(event.toolName);
      }
      const outcome = safeToolOutcome(event.result, event.isError);
      logger.log(`[TOOL end] user=${userTag(userId)} model=${candidate.label} tool=${event.toolName} outcome=${outcome}`);
      options?.onToolStatus?.({ toolName: event.toolName, phase: event.isError ? "error" : "success", outcome });
      guard.onToolEnd();
    }

    if (event.type === "agent_settled") {
      resolveSettled();
    }

    if (event.type === "agent_end") {
      const replyFromMessages = extractLastAssistantText(event.messages);
      if (replyFromMessages) finalReply = replyFromMessages;
      const errorFromMessages = extractLastAssistantError(event.messages);
      if (errorFromMessages) modelError = errorFromMessages;
      // agent_end 也会在 SDK 自动重试前触发；不能在 willRetry=true 时
      // 提前结束等待，否则会把一次正常的自动重试误报为“无回复”。
      if (!event.willRetry) {
        // 若限制已触发，即使 abort 后 SDK 补发了 agent_end 也按超时处理，
        // 保证错误分类稳定（进入现有的 promptError 分支）。
        if (turnLimitError) {
          rejectDone(turnLimitError);
          return;
        }
        // agent_end 后 SDK 还有收尾工作（持久化/压缩检查等），isStreaming
        // 要到 agent_settled 才翻 false（bench 实测收尾约 50ms）。此刻就返回，
        // 下一轮 getOrCreateSession 会撞上 isStreaming=true，跳过记忆变化后
        // 本应发生的 session 重建——连续发消息必中此竞态。等 settle 再放行；
        // 回复已在手，5 秒兜底后即使 SDK 收尾卡住也照常返回，重建由下一轮
        // 的 memoryPrompt 比对兜底。回复完整后 guard 不再需要。
        guard.dispose();
        void Promise.race([settledPromise, sleep(SETTLE_WAIT_MS)]).then(resolveDone);
      }
    }
  });

  const clearActiveMessage = setActiveUserMessage(userId, message, options?.operationId);
  // 每轮注入当前时间（与 todayDate() 同口径的本地时区），模型才能正确解析
  // "昨天/明天"这类相对日期。只注入给模型：NLP 启发式（日期歧义/声称检测）
  // 与 web 层的消息哈希都继续用原始 message，避免时间块污染两者。
  const promptMessage = `${currentDateTimeContext()}

${message}`;
  let promptError: unknown;
  try {
    // prompt() 本身可能挂住不返回；与 donePromise 赛跑，任一先结束都放行本轮。
    await Promise.race([
      session.prompt(promptMessage, { streamingBehavior: "followUp" }).then(() => donePromise),
      donePromise,
    ]);
  } catch (error) {
    promptError = error;
  } finally {
    guard.dispose();
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

function refreshWrittenData(userId: string, toolNames: string[]): Record<string, unknown> {
  const tools = new Set(toolNames);
  const refreshed: Record<string, unknown> = {};
  if (tools.has("create_shopping_task")) refreshed.shoppingTasks = listShoppingTasks(userId);
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
