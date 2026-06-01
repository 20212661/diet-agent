import { getModel, type Model } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

export type ModelAdapterKind = "deepseek" | "glm" | "openai" | "anthropic" | "openrouter" | "sdk-default";

export interface ModelCandidate {
  key: string;
  kind: ModelAdapterKind;
  label: string;
  model?: Model<any>;
  supportsTools: boolean;
  promptPatch: string;
}

export type ModelErrorCategory =
  | "rate_limit"
  | "timeout"
  | "network"
  | "service_unavailable"
  | "tool_write_failure"
  | "tool_failure"
  | "parameter_validation"
  | "user_cancelled"
  | "authentication"
  | "unknown";

export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly isWrite: boolean,
    cause: unknown,
  ) {
    super(`Tool ${toolName} failed: ${errorText(cause)}`, { cause });
    this.name = "ToolExecutionError";
  }
}

const TOOL_RETRY_COUNT = Number(process.env.TOOL_RETRY_COUNT ?? "1");
const WRITE_TOOL_NAMES = new Set([
  "log_meal",
  "update_user_profile",
  "update_kitchen_profile",
  "update_ingredient_inventory",
  "mark_ingredient_used",
  "log_cooking_feedback",
]);

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName);
}

export function createDeepSeekChatModel(): Model<"openai-completions"> | undefined {
  if (!process.env.DEEPSEEK_API_KEY) return undefined;

  return {
    id: "deepseek-chat",
    name: "DeepSeek Chat (V3)",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 8192,
    compat: {
      supportsDeveloperRole: true,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
    },
  };
}

function safeGetModel(provider: string, modelId: string): Model<any> | undefined {
  try {
    return getModel(provider as any, modelId as any);
  } catch (err) {
    console.warn(`[MODEL] Cannot resolve ${provider}/${modelId}: ${(err as Error).message}`);
    return undefined;
  }
}

function candidateFromConfiguredModel(): ModelCandidate | undefined {
  const provider = process.env.MODEL_PROVIDER;
  const modelId = process.env.MODEL_ID;
  if (!provider) return undefined;

  if (provider === "deepseek-chat" || (provider === "deepseek" && modelId === "deepseek-chat")) {
    const model = createDeepSeekChatModel();
    return model ? makeCandidate("deepseek", "deepseek-chat", model) : undefined;
  }

  if (!modelId) return undefined;
  const model = safeGetModel(provider, modelId);
  if (!model) return undefined;

  const kind: ModelAdapterKind =
    provider === "zai" ? "glm" :
    provider === "openai" ? "openai" :
    provider === "anthropic" ? "anthropic" :
    provider === "openrouter" ? "openrouter" :
    "sdk-default";

  return makeCandidate(kind, `${provider}/${modelId}`, model);
}

function makeCandidate(kind: ModelAdapterKind, label: string, model?: Model<any>): ModelCandidate {
  return {
    key: `${kind}:${label}`,
    kind,
    label,
    model,
    supportsTools: kind !== "sdk-default",
    promptPatch: "",
  };
}

export function resolveModelCandidates(): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  const configured = candidateFromConfiguredModel();
  if (configured) candidates.push(configured);

  const deepseek = createDeepSeekChatModel();
  if (deepseek) candidates.push(makeCandidate("deepseek", "deepseek-chat", deepseek));

  if (process.env.ZAI_API_KEY) {
    const glm = safeGetModel("zai", "glm-5-turbo");
    if (glm) candidates.push(makeCandidate("glm", "zai/glm-5-turbo", glm));
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = safeGetModel("openai", process.env.OPENAI_MODEL_ID ?? "gpt-4o");
    if (openai) candidates.push(makeCandidate("openai", `openai/${openai.id}`, openai));
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = safeGetModel("anthropic", process.env.ANTHROPIC_MODEL_ID ?? "claude-sonnet-4-5");
    if (anthropic) candidates.push(makeCandidate("anthropic", `anthropic/${anthropic.id}`, anthropic));
  }

  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = safeGetModel("openrouter", process.env.OPENROUTER_MODEL_ID ?? "deepseek/deepseek-chat");
    if (openrouter) candidates.push(makeCandidate("openrouter", `openrouter/${openrouter.id}`, openrouter));
  }

  candidates.push(makeCandidate("sdk-default", "SDK default"));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

export function shouldFallbackModel(err: unknown): boolean {
  return [
    "rate_limit",
    "timeout",
    "network",
    "service_unavailable",
  ].includes(classifyModelError(err));
}

export function classifyModelError(err: unknown): ModelErrorCategory {
  if (err instanceof ToolExecutionError) {
    return err.isWrite ? "tool_write_failure" : "tool_failure";
  }

  const text = errorText(err).toLowerCase();
  const status = extractStatus(err);

  if (["aborterror", "user cancelled", "user canceled", "cancelled", "canceled"].some((needle) => text.includes(needle))) {
    return "user_cancelled";
  }
  if (status === 401 || status === 403 || ["unauthorized", "forbidden", "invalid api key", "invalid_api_key", "authentication"].some((needle) => text.includes(needle))) {
    return "authentication";
  }
  if (status === 429 || text.includes("rate limit") || text.includes("too many requests")) {
    return "rate_limit";
  }
  if (["timeout", "timed out", "etimedout"].some((needle) => text.includes(needle))) {
    return "timeout";
  }
  if (["econnreset", "econnrefused", "enotfound", "socket hang up", "network error", "fetch failed"].some((needle) => text.includes(needle))) {
    return "network";
  }
  if ([500, 502, 503, 504].includes(status) || ["overloaded", "service unavailable", "bad gateway"].some((needle) => text.includes(needle))) {
    return "service_unavailable";
  }
  if (["schema", "validation", "invalid_request", "invalid request", "invalid json", "json parse"].some((needle) => text.includes(needle))) {
    return "parameter_validation";
  }
  return "unknown";
}

export function wrapToolsForUser(userId: string, tools: ToolDefinition<any>[]): ToolDefinition<any>[] {
  return tools.map((tool) => {
    const completedWriteCalls = new Map<string, Promise<unknown>>();
    return defineTool({
    ...tool,
    prepareArguments: (args: unknown) => {
      const repaired = repairToolArguments(tool.name, args, userId);
      if (tool.prepareArguments) {
        return tool.prepareArguments(repaired);
      }
      return repaired;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (isWriteTool(tool.name)) {
        const existing = completedWriteCalls.get(toolCallId);
        if (existing) return await existing as any;

        const pending = tool.execute(toolCallId, params, signal, onUpdate, ctx)
          .catch((err) => {
            throw new ToolExecutionError(tool.name, true, err);
          });
        completedWriteCalls.set(toolCallId, pending);
        return await pending;
      }

      let lastError: unknown;
      for (let attempt = 0; attempt <= TOOL_RETRY_COUNT; attempt++) {
        try {
          return await tool.execute(toolCallId, params, signal, onUpdate, ctx);
        } catch (err) {
          lastError = err;
          console.warn(`[TOOL retry] tool=${tool.name} attempt=${attempt + 1}/${TOOL_RETRY_COUNT + 1} error=${errorText(err)}`);
          if (!isRetryableToolError(err) || attempt >= TOOL_RETRY_COUNT) break;
        }
      }
      throw new ToolExecutionError(tool.name, false, lastError);
    },
    });
  });
}

export function repairToolArguments(toolName: string, args: unknown, userId: string): any {
  const obj = coerceObject(args);
  obj.userId = userId;

  for (const key of ["availableIngredients", "shoppingList", "cookware", "tastePreferences", "cookingPreferences"]) {
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

  for (const key of ["hasOven", "replaceAvailable", "replaceShoppingList", "tooTiring", "tooManyDishes", "wouldCookAgain"]) {
    if (typeof obj[key] === "string") obj[key] = parseBooleanLike(obj[key]);
  }

  if (typeof obj.energyLevel === "string" && !["low", "normal"].includes(obj.energyLevel)) {
    obj.energyLevel = /累|低|low|tired/i.test(obj.energyLevel) ? "low" : "normal";
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

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function extractStatus(err: unknown): number {
  if (!err || typeof err !== "object") return 0;
  const value = (err as any).status ?? (err as any).statusCode ?? (err as any).code;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
