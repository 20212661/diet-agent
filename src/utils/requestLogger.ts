import * as fs from "node:fs";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_ROOT = path.join(__dirname, "..", "..", "logs", "api-requests");
const MAX_RESPONSE_PREVIEW_CHARS = 12_000;
const REDACTED = "[REDACTED]";
let installed = false;

interface SavedResponse {
  status: number;
  headers: Record<string, string>;
  bodyPreview?: string;
}

interface RequestMetrics {
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  estimatedCostUsd?: number;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function timestampForFilename(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "_",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
    "_",
    String(d.getMilliseconds()).padStart(3, "0"),
  ].join("");
}

function isLlmApiRequest(url: string): boolean {
  return [
    "api.deepseek.com",
    "openai.com",
    "anthropic.com",
    "openrouter.ai",
    "bigmodel.cn",
    "/v1/chat/completions",
    "/chat/completions",
  ].some((fragment) => url.includes(fragment));
}

function sanitizeFilename(value: unknown): string {
  return String(value ?? "unknown").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;"']+/gi, `Bearer ${REDACTED}`)
    .replace(/(authorization|api[-_ ]?key|client[-_ ]?secret|access[-_ ]?token|bearer)\s*[:=]\s*[^\s,;"']+/gi, `$1: ${REDACTED}`)
    .replace(/(健康备注|medicalNotes?|allergies|过敏)\s*[：:]\s*[^\n]+/gi, `$1：${REDACTED}`);
}

function isSensitiveKey(key: string): boolean {
  return /(authorization|api[-_]?key|secret|token|password|medical[-_]?notes?|health[-_]?notes?|allergies|过敏|健康备注)/i.test(key);
}

export function sanitizeForLog(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForLog(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function safeJsonPreview(value: unknown, maxLength = 1_000): string {
  try {
    const sanitized = sanitizeForLog(value);
    const text = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "[unserializable]";
  }
}

function extractUserId(body: any): string {
  for (const msg of body?.messages ?? []) {
    const content = typeof msg.content === "string" ? msg.content : "";
    const match = content.match(/当前用户 ID 是：([^\s\n]+)/);
    if (match?.[1]) return sanitizeFilename(match[1]);
  }
  return "unknown";
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = isSensitiveKey(key) ? REDACTED : redactText(value);
  });
  return result;
}

function parseResponseJson(preview?: string): any | undefined {
  if (!preview) return undefined;
  try {
    return JSON.parse(preview);
  } catch {
    const chunks = preview
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => line.slice(6));
    for (let index = chunks.length - 1; index >= 0; index--) {
      try {
        const parsed = JSON.parse(chunks[index]);
        if (parsed?.usage) return parsed;
      } catch {
        // Ignore malformed streaming chunks.
      }
    }
    return undefined;
  }
}

export function extractRequestMetrics(latencyMs: number, preview?: string): RequestMetrics {
  const parsed = parseResponseJson(preview);
  const usage = parsed?.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  const cacheReadTokens =
    usage.prompt_cache_hit_tokens ??
    usage.cache_read_input_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens;
  const totalTokens = usage.total_tokens ??
    (typeof promptTokens === "number" && typeof completionTokens === "number"
      ? promptTokens + completionTokens
      : undefined);

  const inputCost = numberFromEnv("LLM_INPUT_COST_PER_MILLION", 0);
  const outputCost = numberFromEnv("LLM_OUTPUT_COST_PER_MILLION", 0);
  const cacheReadCost = numberFromEnv("LLM_CACHE_READ_COST_PER_MILLION", 0);
  const uncachedPromptTokens = typeof promptTokens === "number"
    ? Math.max(0, promptTokens - (cacheReadTokens ?? 0))
    : 0;
  const estimatedCostUsd = inputCost || outputCost || cacheReadCost
    ? (
      uncachedPromptTokens * inputCost +
      (cacheReadTokens ?? 0) * cacheReadCost +
      (completionTokens ?? 0) * outputCost
    ) / 1_000_000
    : undefined;

  return {
    latencyMs,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    estimatedCostUsd,
  };
}

export function cleanupExpiredRequestLogs(
  root = LOG_ROOT,
  retentionDays = numberFromEnv("REQUEST_LOG_RETENTION_DAYS", 7),
  now = Date.now(),
): number {
  if (!fs.existsSync(root)) return 0;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      removed += cleanupExpiredRequestLogs(target, retentionDays, now);
      if (fs.readdirSync(target).length === 0) fs.rmdirSync(target);
    } else if (entry.isFile() && fs.statSync(target).mtimeMs < cutoff) {
      fs.unlinkSync(target);
      removed += 1;
    }
  }
  return removed;
}

function saveRequestLog(url: string, body: any, response: SavedResponse, latencyMs: number) {
  try {
    const userId = extractUserId(body);
    const userDir = path.join(LOG_ROOT, userId);
    ensureDir(userDir);
    const sanitizedBody = sanitizeForLog(body) as any;
    const sanitizedResponse = sanitizeForLog(response) as SavedResponse;
    const metrics = extractRequestMetrics(latencyMs, response.bodyPreview);
    const logEntry = {
      _metadata: {
        timestamp: new Date().toISOString(),
        url: redactText(url),
        model: body?.model,
        userId,
        responseStatus: response.status,
      },
      request: sanitizedBody,
      response: sanitizedResponse,
      metrics,
    };
    const filenameBase = `${timestampForFilename()}_${sanitizeFilename(body?.model)}`;
    fs.writeFileSync(path.join(userDir, `${filenameBase}.json`), JSON.stringify(logEntry, null, 2), "utf8");
    fs.writeFileSync(path.join(userDir, `${filenameBase}.txt`), formatReadable(logEntry), "utf8");
  } catch (err) {
    console.warn("[request-log] failed to save:", (err as Error).message);
  }
}

function formatReadable(log: any): string {
  return [
    `Time: ${log._metadata.timestamp}`,
    `URL: ${log._metadata.url}`,
    `Model: ${log._metadata.model}`,
    `User: ${log._metadata.userId}`,
    `Status: HTTP ${log._metadata.responseStatus}`,
    `Latency: ${log.metrics.latencyMs} ms`,
    `Tokens: prompt=${log.metrics.promptTokens ?? "unknown"} cacheRead=${log.metrics.cacheReadTokens ?? "unknown"} completion=${log.metrics.completionTokens ?? "unknown"} total=${log.metrics.totalTokens ?? "unknown"}`,
    `Estimated cost: ${log.metrics.estimatedCostUsd ?? "not configured"}`,
    "",
    "REQUEST",
    safeJsonPreview(log.request, 8_000),
    "",
    "RESPONSE PREVIEW",
    log.response.bodyPreview ?? "",
  ].join("\n");
}

async function readResponsePreview(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return redactText(text.length > MAX_RESPONSE_PREVIEW_CHARS
      ? `${text.slice(0, MAX_RESPONSE_PREVIEW_CHARS)}...`
      : text);
  } catch {
    return undefined;
  }
}

export function installRequestLogger(): boolean {
  if (process.env.ENABLE_REQUEST_LOGS !== "1" || installed) return false;
  installed = true;
  ensureDir(LOG_ROOT);
  cleanupExpiredRequestLogs();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startedAt = Date.now();
    const response = await originalFetch.call(globalThis, input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (!isLlmApiRequest(url) || !init?.body || typeof init.body !== "string") return response;
      const body = JSON.parse(init.body);
      const preview = await readResponsePreview(response.clone());
      saveRequestLog(url, body, {
        status: response.status,
        headers: sanitizeHeaders(response.headers),
        bodyPreview: preview,
      }, Date.now() - startedAt);
    } catch {
      // Diagnostics must never affect the request flow.
    }
    return response;
  };
  return true;
}
