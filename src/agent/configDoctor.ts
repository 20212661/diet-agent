import {
  PROVIDER_CONFIGS,
  configuredModelForProvider,
  getProviderConfig,
  normalizeProviderId,
} from "./modelProviders.js";

export type ModelCheckCode =
  | "ok"
  | "missing_provider"
  | "missing_key"
  | "invalid_key"
  | "invalid_model"
  | "network_error"
  | "provider_error"
  | "remote_check_unavailable";

export interface ModelCheckResult {
  ok: boolean;
  severity: "ok" | "warning" | "error";
  code: ModelCheckCode;
  provider?: string;
  model?: string;
  message: string;
  nextStep?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * 启动前检查模型配置。DeepSeek 使用 /models 做真实认证和模型检查；
 * 其它 provider 目前只做无敏感信息的本地完整性检查。
 */
export async function checkModelConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch,
  timeoutMs = 5_000
): Promise<ModelCheckResult> {
  const provider = inferProvider(env);
  if (!provider) {
    return failure("missing_provider", "未配置模型供应商或 API Key。", undefined, undefined);
  }

  const config = getProviderConfig(provider);
  const keyEnv = config?.apiKeyEnv;
  const apiKey = keyEnv ? env[keyEnv]?.trim() : undefined;
  const model = config ? configuredModelForProvider(config, env, provider) : undefined;

  if (!keyEnv || !apiKey) {
    return failure(
      "missing_key",
      keyEnv ? `缺少 ${keyEnv}。` : `不支持的模型供应商：${provider}。`,
      provider,
      model
    );
  }

  if (!model) {
    return failure("invalid_model", "没有配置模型 ID。", provider, undefined);
  }

  if (provider !== "deepseek") {
    return {
      ok: false,
      severity: "warning",
      code: "remote_check_unavailable",
      provider,
      model,
      message: `已检查 ${provider} 的本地配置；该供应商暂未执行远程认证检查，连接状态仍未验证。`,
      nextStep: "可运行 npm run doctor 检查本地配置，或发起一次饮食助手请求验证实际调用。",
    };
  }

  const baseUrl = (env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return failure("invalid_key", "DeepSeek API Key 无效或无权访问。", provider, model);
    }
    if (!response.ok) {
      return {
        ok: false,
        severity: "warning",
        code: "provider_error",
        provider,
        model,
        message: `DeepSeek 配置检查返回 HTTP ${response.status}。`,
        nextStep: "检查 API Key、账户权限和服务地址后重新验证。",
      };
    }

    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const available = new Set(
      (payload.data ?? [])
        .map((item) => typeof item.id === "string" ? item.id : "")
        .filter(Boolean)
    );
    if (available.size > 0 && !available.has(model)) {
      return failure("invalid_model", `DeepSeek 当前账户不可用模型：${model}。`, provider, model);
    }

    return {
      ok: true,
      severity: "ok",
      code: "ok",
      provider,
      model,
      message: `模型配置有效：${provider}/${model}。`,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "检查超时" : "无法连接模型服务";
    return {
      ok: false,
      severity: "warning",
      code: "network_error",
      provider,
      model,
      message: `${reason}。`,
      nextStep: "检查网络、代理和 DEEPSEEK_BASE_URL，然后重新验证；也可运行 npm run doctor。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatModelCheckResult(result: ModelCheckResult): string {
  const prefix = result.severity === "ok" ? "✅" : result.severity === "warning" ? "⚠️" : "❌";
  return `${prefix} ${result.message}`;
}

function inferProvider(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.MODEL_PROVIDER?.trim();
  if (configured) return normalizeProviderId(configured);
  return PROVIDER_CONFIGS.find((config) => Boolean(env[config.apiKeyEnv]?.trim()))?.id;
}

function failure(
  code: Extract<ModelCheckCode, "missing_provider" | "missing_key" | "invalid_key" | "invalid_model">,
  message: string,
  provider?: string,
  model?: string
): ModelCheckResult {
  const nextStep = code === "missing_provider" || code === "missing_key"
    ? "检查 .env 中的 MODEL_PROVIDER 和对应 API Key，保存后重启本地服务。"
    : code === "invalid_model"
      ? "检查 MODEL_ID 是否为该供应商支持的模型，然后重新验证。"
      : "检查 API Key 是否有效以及账户是否有调用权限，然后重新验证。";
  return { ok: false, severity: "error", code, provider, model, message, nextStep };
}
