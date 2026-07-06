import * as fs from "node:fs";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const LOG_ROOT = path.join(PROJECT_ROOT, "logs", "api-requests");
const MAX_RESPONSE_PREVIEW_CHARS = 12_000;

interface SavedResponse {
  status: number;
  headers: Record<string, string>;
  bodyPreview?: string;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
  return (
    url.includes("api.deepseek.com") ||
    url.includes("openai.com") ||
    url.includes("anthropic.com") ||
    url.includes("openrouter.ai") ||
    url.includes("bigmodel.cn") ||
    url.includes("/v1/chat/completions") ||
    url.includes("/chat/completions")
  );
}

function sanitizeFilename(value: unknown): string {
  return String(value ?? "unknown").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

function safeJsonPreview(value: unknown, maxLength = 1_000): string {
  if (value === undefined) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "[unserializable]";
  }
}

function extractUserId(body: any): string {
  for (const msg of body?.messages ?? []) {
    const content = typeof msg.content === "string" ? msg.content : "";
    const patterns = [
      /当前用户 ID 是：([^\s\n]+)/,
      /当前用户 ID 是 \*\*([^*\s]+)\*\*/,
      /userId[：:]\s*([^\s\n]+)/i,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return "unknown";
}

function summarizeTools(tools: any[] | undefined) {
  return (tools ?? []).map((tool) => {
    const func = tool.function ?? tool;
    return {
      name: func.name,
      description: func.description,
      parameters: func.parameters,
    };
  });
}

function extractMessageToolEvents(messages: any[] | undefined) {
  const events: Array<{ role: string; type: string; name?: string; id?: string; preview: string }> = [];

  for (const msg of messages ?? []) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_use") {
          events.push({
            role: msg.role,
            type: "tool_use",
            name: block.name,
            id: block.id,
            preview: safeJsonPreview(block.input),
          });
        }
        if (block?.type === "tool_result") {
          events.push({
            role: msg.role,
            type: "tool_result",
            id: block.tool_use_id,
            preview: safeJsonPreview(block.content),
          });
        }
      }
    }

    if (Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        events.push({
          role: msg.role,
          type: "tool_call",
          name: call.function?.name,
          id: call.id,
          preview: safeJsonPreview(call.function?.arguments),
        });
      }
    }

    if (msg.role === "tool") {
      events.push({
        role: msg.role,
        type: "tool_result",
        id: msg.tool_call_id,
        preview: safeJsonPreview(msg.content),
      });
    }
  }

  return events;
}

function saveRequestLog(url: string, body: any, response: SavedResponse) {
  try {
    const timestamp = timestampForFilename();
    const userId = extractUserId(body);
    const userDir = path.join(LOG_ROOT, userId);
    ensureDir(userDir);

    const logEntry = {
      _metadata: {
        timestamp: new Date().toISOString(),
        url,
        model: body?.model,
        userId,
        responseStatus: response.status,
      },
      request: {
        model: body?.model,
        messages: body?.messages,
        tools: body?.tools,
        tool_choice: body?.tool_choice,
        temperature: body?.temperature,
        max_tokens: body?.max_tokens,
        top_p: body?.top_p,
        stream: body?.stream,
      },
      response,
      diagnostics: {
        toolCount: body?.tools?.length ?? 0,
        toolNames: summarizeTools(body?.tools).map((tool) => tool.name),
        messageToolEvents: extractMessageToolEvents(body?.messages),
      },
    };

    const filenameBase = `${timestamp}_${sanitizeFilename(body?.model)}`;
    const jsonPath = path.join(userDir, `${filenameBase}.json`);
    const textPath = path.join(userDir, `${filenameBase}.txt`);

    fs.writeFileSync(jsonPath, JSON.stringify(logEntry, null, 2), "utf-8");
    fs.writeFileSync(textPath, formatReadable(logEntry), "utf-8");

    console.log(`[request-log] saved logs/api-requests/${userId}/${filenameBase}.json`);
  } catch (err) {
    console.warn("[request-log] failed to save:", (err as Error).message);
  }
}

function formatReadable(log: any): string {
  const lines: string[] = [];
  const meta = log._metadata;
  const request = log.request;

  lines.push("=".repeat(72));
  lines.push(`Time:   ${meta.timestamp}`);
  lines.push(`URL:    ${meta.url}`);
  lines.push(`Model:  ${meta.model}`);
  lines.push(`User:   ${meta.userId}`);
  lines.push(`Status: HTTP ${meta.responseStatus}`);
  lines.push("=".repeat(72));

  if (request.messages?.length) {
    lines.push("");
    lines.push("MESSAGES");
    for (const msg of request.messages) {
      lines.push("");
      lines.push(`[${String(msg.role ?? "unknown").toUpperCase()}]`);
      if (typeof msg.content === "string") {
        lines.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") lines.push(block.text);
          else lines.push(`[${block.type}] ${safeJsonPreview(block, 500)}`);
        }
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          lines.push(`[tool_call] ${call.function?.name} ${safeJsonPreview(call.function?.arguments, 500)}`);
        }
      }
    }
  }

  if (request.tools?.length) {
    lines.push("");
    lines.push(`TOOLS (${request.tools.length})`);
    for (const tool of summarizeTools(request.tools)) {
      lines.push(`- ${tool.name}`);
      if (tool.description) lines.push(`  ${String(tool.description).slice(0, 160)}`);
    }
  }

  if (log.diagnostics.messageToolEvents.length > 0) {
    lines.push("");
    lines.push("TOOL EVENTS IN MESSAGES");
    for (const event of log.diagnostics.messageToolEvents) {
      lines.push(`- ${event.type} ${event.name ?? event.id ?? ""}: ${event.preview}`);
    }
  }

  lines.push("");
  lines.push("PARAMETERS");
  if (request.temperature !== undefined) lines.push(`temperature: ${request.temperature}`);
  if (request.max_tokens !== undefined) lines.push(`max_tokens: ${request.max_tokens}`);
  if (request.top_p !== undefined) lines.push(`top_p: ${request.top_p}`);
  if (request.stream !== undefined) lines.push(`stream: ${request.stream}`);
  if (request.tool_choice !== undefined) lines.push(`tool_choice: ${JSON.stringify(request.tool_choice)}`);

  if (log.response.bodyPreview) {
    lines.push("");
    lines.push("RESPONSE PREVIEW");
    lines.push(log.response.bodyPreview);
  }

  lines.push("");
  lines.push("=".repeat(72));
  return lines.join("\n");
}

async function readResponsePreview(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > MAX_RESPONSE_PREVIEW_CHARS
      ? `${text.slice(0, MAX_RESPONSE_PREVIEW_CHARS)}...`
      : text;
  } catch {
    return undefined;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function installRequestLogger() {
  ensureDir(LOG_ROOT);
  console.log(`[request-log] LLM API requests will be saved to: ${LOG_ROOT}`);

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const response = await originalFetch.call(globalThis, input, init);

    try {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

      if (!isLlmApiRequest(url) || !init?.body || typeof init.body !== "string") {
        return response;
      }

      let reqBody: any;
      try {
        reqBody = JSON.parse(init.body);
      } catch {
        return response;
      }

      const clonedResponse = response.clone();
      void readResponsePreview(clonedResponse).then((bodyPreview) => {
        saveRequestLog(url, reqBody, {
          status: response.status,
          headers: headersToRecord(response.headers),
          bodyPreview,
        });
      });
    } catch {
      // Logging must never affect normal request flow.
    }

    return response;
  };
}
