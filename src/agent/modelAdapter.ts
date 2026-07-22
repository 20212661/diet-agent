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

const TOOL_RETRY_COUNT = Number(process.env.TOOL_RETRY_COUNT ?? "1");

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
    cost: { input: 0.27, output: 1.1, cacheRead: 0, cacheWrite: 0 },
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
    promptPatch: buildModelPromptPatch(kind),
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
  const text = errorText(err).toLowerCase();
  return [
    "rate limit",
    "429",
    "timeout",
    "timed out",
    "econnreset",
    "socket hang up",
    "overloaded",
    "503",
    "502",
    "500",
    "tool",
    "json",
    "schema",
    "invalid_request",
  ].some((needle) => text.includes(needle));
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
          console.warn(`[TOOL retry] tool=${tool.name} attempt=${attempt + 1}/${TOOL_RETRY_COUNT + 1} error=${errorText(err)}`);
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

  for (const key of ["availableIngredients", "shoppingList", "cookware", "tastePreferences", "cookingPreferences", "preferredStyles"]) {
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

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
