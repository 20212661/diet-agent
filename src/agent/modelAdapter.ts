import { getModel, type Model } from "@earendil-works/pi-ai/compat";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  PROVIDER_CONFIGS,
  configuredModelForProvider,
  normalizeConfiguredModelId,
  normalizeProviderId,
  type ModelAdapterKind,
} from "./modelProviders.js";
import { getActiveOperationId } from "../utils/userTurnContext.js";
import { TurnLimitError } from "./turnGuard.js";
import { UNCONFIRMED_TOOL_STATUS, WRITE_TOOLS } from "./toolOutcomes.js";
import {
  classifyArgumentRepairs,
  isStructuralJsonArgs,
  recordToolArgumentIssues,
  toolRepairRecordingActive,
  type ToolIssueCategory,
} from "./toolRepairTelemetry.js";

export type { ModelAdapterKind } from "./modelProviders.js";

export interface ModelCandidate {
  key: string;
  provider: string;
  kind: ModelAdapterKind;
  label: string;
  model?: Model<any>;
  supportsTools: boolean;
  promptPatch: string;
}

const TOOL_RETRY_COUNT = Number(process.env.TOOL_RETRY_COUNT ?? "1");

/** 单个工具执行超时；运行期读取以便测试覆盖。工具执行期间 TurnGuard 的空闲计时是暂停的，靠它兜底。 */
function toolTimeoutMs(): number {
  const value = Number(process.env.AGENT_TOOL_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 20_000;
}

export class ToolTimeoutError extends Error {
  constructor(
    readonly toolName: string,
    readonly timeoutMs: number,
  ) {
    super(`Tool ${toolName} timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

/**
 * 会话被 TurnGuard 中止后，其写工具继续执行会破坏“超时未发生写入”的承诺
 * （chatStream 已按该承诺告知用户可安全重试），因此用 fence 直接拒绝。
 */
export class FencedToolError extends Error {
  constructor(readonly toolName: string) {
    super(`写入被拒绝：会话已因超时中止，${toolName} 不会执行；请勿重试写入，等待用户重新发起请求。`);
    this.name = "FencedToolError";
  }
}

interface ToolFence {
  /** 所属会话被 TurnGuard 中止后置 true；仅写工具检查。 */
  fenced: boolean;
}

/**
 * userId → 最近一次 wrapToolsForUser 注册的 fence。
 * guard 触发时置位“当前”fence（即正在执行的那轮会话的工具组）；
 * 重建会话会调用新的 wrapToolsForUser 注册全新 fence，旧会话的工具闭包
 * 仍持有已置位的旧 fence，因此僵尸会话（abort 挂死、SDK 循环未停）的
 * 写工具会被永久拒绝，而新会话不受影响。
 */
const activeToolFences = new Map<string, ToolFence>();

/** TurnGuard 触发时调用：fence 该用户当前会话的写工具。 */
export function fenceUserTools(userId: string): void {
  const fence = activeToolFences.get(userId);
  if (fence) fence.fenced = true;
}

export function normalizeModelId(provider: string, modelId: string): string {
  return normalizeConfiguredModelId(provider, modelId);
}

export interface ModelRequest {
  provider: string;
  kind: Exclude<ModelAdapterKind, "sdk-default">;
  modelId: string;
}

export function createDeepSeekFlashModel(): Model<any> | undefined {
  if (!process.env.DEEPSEEK_API_KEY) return undefined;
  return safeGetModel("deepseek", "deepseek-flash");
}

function safeGetModel(provider: string, modelId: string): Model<any> | undefined {
  try {
    return getModel(provider as any, modelId as any);
  } catch (err) {
    console.warn(`[MODEL] Cannot resolve ${provider}/${modelId}; errorType=${err instanceof Error ? err.name : typeof err}`);
    return undefined;
  }
}

function makeCandidate(provider: string, kind: ModelAdapterKind, label: string, model?: Model<any>): ModelCandidate {
  return {
    key: `${provider}:${label}`,
    provider,
    kind,
    label,
    model,
    supportsTools: kind !== "sdk-default",
    promptPatch: buildModelPromptPatch(kind),
  };
}

export function resolveModelRequests(env: NodeJS.ProcessEnv = process.env): ModelRequest[] {
  const configuredProvider = env.MODEL_PROVIDER
    ? normalizeProviderId(env.MODEL_PROVIDER)
    : undefined;
  const primaryProvider = configuredProvider ?? PROVIDER_CONFIGS.find(
    (config) => Boolean(env[config.apiKeyEnv]?.trim())
  )?.id;
  const ordered = [...PROVIDER_CONFIGS].sort((left, right) => {
    if (left.id === configuredProvider) return -1;
    if (right.id === configuredProvider) return 1;
    return 0;
  });
  return ordered.flatMap((config): ModelRequest[] => {
    if (!env[config.apiKeyEnv]?.trim()) return [];
    return [{
      provider: config.id,
      kind: config.kind,
      modelId: configuredModelForProvider(config, env, primaryProvider),
    }];
  });
}

export function resolveModelCandidates(): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  for (const request of resolveModelRequests()) {
    const model = safeGetModel(request.provider, request.modelId);
    if (model) candidates.push(makeCandidate(
      request.provider,
      request.kind,
      `${request.provider}/${request.modelId}`,
      model
    ));
  }

  // 有显式 provider 时不要再追加 SDK default：它通常会读取同一份环境变量，
  // 认证失败时重复请求只会掩盖真正的 provider/model 错误。
  if (candidates.length === 0) {
    candidates.push(makeCandidate("sdk-default", "sdk-default", "SDK default"));
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

export function buildModelPromptPatch(kind: ModelAdapterKind): string {
  const common = [
    "## 模型适配规则",
    "如果需要调用工具，只能使用系统提供的工具名和参数 schema。",
    "工具参数必须是 JSON object，不要把 JSON 放进 markdown 代码块。",
    "无法确定字段时省略该字段，不要编造。",
  ];

  if (kind === "glm") {
    common.push(
      "GLM 适配：工具参数必须保持扁平清晰；数组字段必须传数组，不要传逗号分隔字符串。",
      "GLM 适配：涉及食材、购物清单、厨房条件、反馈时，先调用对应工具，再根据工具结果回复。"
    );
  }

  if (kind === "deepseek") {
    common.push(
      "DeepSeek 适配：优先一次只调用最相关的工具；不要在同一轮里重复调用同一个写入工具。",
      "DeepSeek 适配：回复时保留工具返回的结构，不要扩写成无法执行的泛泛建议。"
    );
  }

  return common.join("\n");
}

export function shouldFallbackModel(err: unknown): boolean {
  return classifyModelError(err).retryable;
}

export type ModelErrorKind =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "server"
  | "model_unavailable"
  | "invalid_request"
  | "unknown";

export interface ModelErrorClassification {
  kind: ModelErrorKind;
  retryable: boolean;
  status?: number;
}

export function classifyModelError(error: unknown): ModelErrorClassification {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const nested = record?.cause && typeof record.cause === "object" ? record.cause as Record<string, unknown> : undefined;
  const rawStatus = record?.status ?? record?.statusCode ?? nested?.status ?? nested?.statusCode;
  const status = typeof rawStatus === "number" ? rawStatus :
    typeof rawStatus === "string" && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : undefined;
  const code = String(record?.code ?? nested?.code ?? "").toUpperCase();
  const name = error instanceof Error ? error.name : "";
  const message = errorText(error).toLowerCase();
  const statusFromMessage = /\bhttp\s*(\d{3})\b/i.exec(message)?.[1];
  const effectiveStatus = status ?? (statusFromMessage ? Number(statusFromMessage) : undefined);

  if (effectiveStatus === 401 || effectiveStatus === 403 || /\b(authentication|unauthorized|invalid api key)\b/.test(message)) {
    return { kind: "authentication", retryable: true, status: effectiveStatus };
  }
  if (effectiveStatus === 429 || code === "RATE_LIMITED" || /\brate limit(?:ed)?\b/.test(message)) {
    return { kind: "rate_limit", retryable: true, status: effectiveStatus };
  }
  if (name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || /\btimed? out\b/.test(message)) {
    return { kind: "timeout", retryable: true, status };
  }
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return { kind: "network", retryable: true, status };
  }
  if (effectiveStatus !== undefined && effectiveStatus >= 500) {
    return { kind: "server", retryable: true, status: effectiveStatus };
  }
  if (effectiveStatus === 404 || code === "MODEL_NOT_FOUND") {
    return { kind: "model_unavailable", retryable: true, status: effectiveStatus };
  }
  if (effectiveStatus === 400 || effectiveStatus === 422 || code === "INVALID_REQUEST") {
    return { kind: "invalid_request", retryable: false, status: effectiveStatus };
  }
  return { kind: "unknown", retryable: false, status };
}

export function shouldFallbackToCandidate(
  error: unknown,
  failed: ModelCandidate,
  next: ModelCandidate | undefined
): boolean {
  if (!next) return false;
  // TurnGuard 超时要区分原因：idle 多为 provider 连接卡死，换一家大概率恢复；
  // deadline / 预算超限说明模型行为异常（循环、超长），换模型重跑只会再花
  // 一倍的时间和 token。
  if (error instanceof TurnLimitError) return error.reason === "idle";
  const classification = classifyModelError(error);
  if (!classification.retryable) return false;
  return classification.kind !== "authentication" || failed.provider !== next.provider;
}

export function wrapToolsForUser(userId: string, tools: ToolDefinition<any>[]): ToolDefinition<any>[] {
  const fence: ToolFence = { fenced: false };
  activeToolFences.set(userId, fence);
  return tools.map((tool) => {
    const requiredFields = requiredSchemaFieldsExcludingIdentity(tool);
    return defineTool({
    ...tool,
    prepareArguments: (args: unknown) => {
      const repaired = coerceAndInjectArguments(tool.name, args, userId);
      if (toolRepairEnabled()) {
        const recording = toolRepairRecordingActive();
        const before = recording ? structuredClone(repaired) : undefined;
        applyToolTypeRepairs(tool.name, repaired);
        if (recording && before) {
          // 仅评测模式记录：修复前后差异 + 结构问题 + 缺失的必填字段。
          const categories: ToolIssueCategory[] = classifyArgumentRepairs(before, repaired);
          if (isStructuralJsonArgs(args)) categories.push("json_string_args");
          if (requiredFields.some((field) => before[field] === undefined)) categories.push("missing_field");
          recordToolArgumentIssues(tool.name, categories);
        }
      }
      if (tool.prepareArguments) {
        return tool.prepareArguments(repaired);
      }
      return repaired;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (fence.fenced && WRITE_TOOLS.has(tool.name)) {
        throw new FencedToolError(tool.name);
      }
      let lastError: unknown;
      for (let attempt = 0; attempt <= TOOL_RETRY_COUNT; attempt++) {
        try {
          const call = tool.execute(toolCallId, params, signal, onUpdate, ctx);
          const timeoutMs = toolTimeoutMs();
          let timer: NodeJS.Timeout | undefined;
          try {
            return await Promise.race([
              call,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new ToolTimeoutError(tool.name, timeoutMs)), timeoutMs);
              }),
            ]);
          } catch (error) {
            if (error instanceof ToolTimeoutError && WRITE_TOOLS.has(tool.name)) {
              // 写工具超时：底层调用可能仍在后台执行完，不能确认是否已保存。
              // 不抛错、不自动重试，返回结构化“未确认”结果提示模型停止重试，
              // 由 runAgentSessionTurn 归入 uncertainWriteTools 要求人工核对。
              return {
                content: [{
                  type: "text" as const,
                  text: `${tool.label ?? tool.name} 执行超时，无法确认是否已保存；请勿重试该写入，向用户说明需要核对后由用户决定。`,
                }],
                details: { status: UNCONFIRMED_TOOL_STATUS, retryForbidden: true },
              };
            }
            throw error;
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          lastError = err;
          console.warn(`[TOOL retry] tool=${tool.name} attempt=${attempt + 1}/${TOOL_RETRY_COUNT + 1} errorType=${err instanceof Error ? "Error" : typeof err} code=${safeToolErrorCode(err)}`);
          // 超时一律不自动重试：超时的调用可能仍在后台执行完，立即重跑有叠加风险。
          if (err instanceof ToolTimeoutError || !isRetryableToolError(err) || attempt >= TOOL_RETRY_COUNT) break;
        }
      }
      throw lastError;
    },
    });
  });
}

/**
 * DIET_TOOL_REPAIR=off 用于 A/B 评测：只关类型修复。
 * userId（安全隔离）与 operationId（幂等）注入不受影响，始终保留——
 * 关掉它们会让对比不公平，也会带来越权风险。
 */
export function toolRepairEnabled(): boolean {
  return process.env.DIET_TOOL_REPAIR !== "off";
}

/** 结构解析 + 安全注入 + 幂等注入；不属于“类型修复”，不受开关影响。 */
export function coerceAndInjectArguments(toolName: string, args: unknown, userId: string): Record<string, any> {
  const obj = coerceObject(args);
  obj.userId = userId;
  if (["log_meal", "edit_meal_log", "undo_meal_log"].includes(toolName) && !obj.operationId) {
    const operationId = getActiveOperationId(userId, toolName);
    if (operationId) obj.operationId = operationId;
  }
  return obj;
}

export function repairToolArguments(toolName: string, args: unknown, userId: string): any {
  const obj = coerceAndInjectArguments(toolName, args, userId);
  if (toolRepairEnabled()) applyToolTypeRepairs(toolName, obj);
  return obj;
}

/** 类型修复本体：数组/布尔/数字的字符串形态转换与字段规范化。 */
function applyToolTypeRepairs(toolName: string, obj: Record<string, any>): void {
  for (const key of ["availableIngredients", "shoppingList", "cookware", "tastePreferences", "cookingPreferences", "preferredStyles", "temporaryAvoidFoods"]) {
    if (typeof obj[key] === "string") obj[key] = splitList(obj[key]);
  }

  if (toolName === "log_meal" && typeof obj.foods === "string") {
    obj.foods = splitList(obj.foods).map((name: string) => ({ name, amount: "未注明" }));
  }

  for (const key of ["burners", "maxActiveMinutes", "maxTotalMinutes", "timeLimitMinutes", "days", "rating", "actualActiveMinutes", "actualTotalMinutes"]) {
    if (typeof obj[key] === "string" && obj[key].trim() !== "" && !Number.isNaN(Number(obj[key]))) {
      obj[key] = Number(obj[key]);
    }
  }

  for (const key of ["hasOven", "hasMicrowave", "hasRiceCooker", "replaceAvailable", "replaceShoppingList", "tooTiring", "tooManyDishes", "wouldCookAgain"]) {
    if (typeof obj[key] === "string") obj[key] = parseBooleanLike(obj[key]);
  }

  if (typeof obj.energyLevel === "string" && !["low", "normal"].includes(obj.energyLevel)) {
    obj.energyLevel = /累|低|low|tired/i.test(obj.energyLevel) ? "low" : "normal";
  }

  if (toolName === "generate_weekly_plan") {
    if (typeof obj.avoidDays === "string") {
      obj.avoidDays = splitList(obj.avoidDays).map(Number).filter((n: number) => !Number.isNaN(n));
    }
    if (Array.isArray(obj.energyOverrides)) {
      obj.energyOverrides = obj.energyOverrides.map((eo: any) => ({
        ...eo,
        dayOfWeek: typeof eo.dayOfWeek === "string" ? Number(eo.dayOfWeek) : eo.dayOfWeek,
      }));
    }
  }
}

/** schema 必填字段（排除中间件强制注入的身份/幂等字段），用于“缺字段”统计。 */
function requiredSchemaFieldsExcludingIdentity(tool: ToolDefinition<any>): string[] {
  const schema = tool.parameters as { required?: unknown } | undefined;
  if (!Array.isArray(schema?.required)) return [];
  return (schema.required as unknown[]).filter(
    (field): field is string => typeof field === "string" && field !== "userId" && field !== "operationId",
  );
}

function coerceObject(args: unknown): Record<string, any> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, any>;
    if (typeof record.arguments === "string") return coerceObject(record.arguments);
    if (record.input && typeof record.input === "object") return { ...(record.input as Record<string, any>) };
    return { ...record };
  }

  if (typeof args === "string") {
    const cleaned = args
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    try {
      return coerceObject(JSON.parse(cleaned));
    } catch {
      return { value: args };
    }
  }

  return {};
}

function splitList(value: string): string[] {
  return value
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanLike(value: string): boolean | undefined {
  if (/^(true|yes|y|1|有|是|好|需要|推荐)$/i.test(value.trim())) return true;
  if (/^(false|no|n|0|无|没有|否|不|不用|不推荐)$/i.test(value.trim())) return false;
  return undefined;
}

function isRetryableToolError(err: unknown): boolean {
  const text = errorText(err).toLowerCase();
  return ["busy", "locked", "timeout", "temporary", "sqlite_busy", "econnreset"].some((needle) => text.includes(needle));
}

function safeToolErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && ["SQLITE_BUSY", "SQLITE_LOCKED", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code)
    ? code : "unknown";
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
