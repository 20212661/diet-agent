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
  const classification = classifyModelError(error);
  if (!classification.retryable) return false;
  return classification.kind !== "authentication" || failed.provider !== next.provider;
}

export function wrapToolsForUser(userId: string, tools: ToolDefinition<any>[]): ToolDefinition<any>[] {
  return tools.map((tool) => defineTool({
    ...tool,
    prepareArguments: (args: unknown) => {
      const repaired = repairToolArguments(tool.name, args, userId);
      if (tool.prepareArguments) {
        return tool.prepareArguments(repaired);
      }
      return repaired;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      let lastError: unknown;
      for (let attempt = 0; attempt <= TOOL_RETRY_COUNT; attempt++) {
        try {
          return await tool.execute(toolCallId, params, signal, onUpdate, ctx);
        } catch (err) {
          lastError = err;
          console.warn(`[TOOL retry] tool=${tool.name} attempt=${attempt + 1}/${TOOL_RETRY_COUNT + 1} errorType=${err instanceof Error ? "Error" : typeof err} code=${safeToolErrorCode(err)}`);
          if (!isRetryableToolError(err) || attempt >= TOOL_RETRY_COUNT) break;
        }
      }
      throw lastError;
    },
  }));
}

export function repairToolArguments(toolName: string, args: unknown, userId: string): any {
  const obj = coerceObject(args);
  obj.userId = userId;
  if (["log_meal", "edit_meal_log", "undo_meal_log"].includes(toolName) && !obj.operationId) {
    const operationId = getActiveOperationId(userId, toolName);
    if (operationId) obj.operationId = operationId;
  }

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

  return obj;
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
