export type ModelAdapterKind = "deepseek" | "glm" | "openai" | "anthropic" | "openrouter" | "sdk-default";

export interface ProviderConfig {
  id: string;
  kind: Exclude<ModelAdapterKind, "sdk-default">;
  apiKeyEnv: string;
  modelEnv?: string;
  defaultModel: string;
  aliases?: Readonly<Record<string, string>>;
}

export const PROVIDER_CONFIGS: readonly ProviderConfig[] = [
  {
    id: "deepseek",
    kind: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-flash",
    aliases: {
      "deepseek-v4-flash": "deepseek-flash",
      "deepseek-chat": "deepseek-flash",
      "deepseek-reasoner": "deepseek-flash",
    },
  },
  {
    id: "zai",
    kind: "glm",
    apiKeyEnv: "ZAI_API_KEY",
    modelEnv: "ZAI_MODEL_ID",
    defaultModel: "glm-5-turbo",
  },
  {
    id: "openai",
    kind: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL_ID",
    defaultModel: "gpt-4o",
  },
  {
    id: "anthropic",
    kind: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL_ID",
    defaultModel: "claude-sonnet-4-5",
  },
  {
    id: "openrouter",
    kind: "openrouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL_ID",
    defaultModel: "deepseek/deepseek-chat",
  },
] as const;

export function normalizeProviderId(provider: string): string {
  return provider === "deepseek-chat" ? "deepseek" : provider;
}

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  const normalized = normalizeProviderId(provider);
  return PROVIDER_CONFIGS.find((config) => config.id === normalized);
}

export function normalizeConfiguredModelId(provider: string, modelId: string): string {
  const config = getProviderConfig(provider);
  return config?.aliases?.[modelId] ?? modelId;
}

export function configuredModelForProvider(
  config: ProviderConfig,
  env: NodeJS.ProcessEnv,
  primaryProvider = normalizeProviderId(env.MODEL_PROVIDER ?? "")
): string {
  const explicit = primaryProvider === config.id
    ? env.MODEL_ID
    : config.modelEnv ? env[config.modelEnv] : undefined;
  return normalizeConfiguredModelId(config.id, explicit?.trim() || config.defaultModel);
}
