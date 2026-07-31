/**
 * Embedding 适配层
 *
 * SDK（pi-ai）不提供 embedding 能力，这里自己发 HTTP。
 * OpenAI 与智谱 GLM 的 embeddings API 都是 OpenAI 兼容格式
 * （POST {baseUrl}/embeddings，body {model, input}，响应 data[0].embedding），
 * 所以用一套调用，仅 baseUrl/model/dim 按 provider 切换。
 *
 * 参考 modelAdapter.ts 的 provider 探测模式：按环境变量是否存在决定用哪个 provider。
 */
import Database from "better-sqlite3";

export type EmbeddingProvider = "openai" | "zai";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  baseUrl: string; // 含版本路径，如 https://api.openai.com/v1
  apiKey: string;
  dim: number;
}

export interface EmbeddingResult {
  vector: number[]; // 已归一化（单位向量）
  dim: number;
  provider: EmbeddingProvider;
}

const PROVIDER_DEFAULTS: Record<EmbeddingProvider, { model: string; baseUrl: string; dim: number }> = {
  openai: {
    model: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    dim: 1536,
  },
  zai: {
    model: "embedding-3",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    dim: 1024,
  },
};

/**
 * 解析当前可用的 embedding 配置。
 * 优先级：EMBEDDING_PROVIDER 显式指定 > ZAI_API_KEY（国内优先）> OPENAI_API_KEY。
 * 都没有则返回 undefined（RAG 关闭，退回纯 matcher）。
 */
export function resolveEmbeddingConfig(): EmbeddingConfig | undefined {
  const explicit = process.env.EMBEDDING_PROVIDER as EmbeddingProvider | undefined;
  if (explicit === "openai" && process.env.OPENAI_API_KEY) {
    return makeConfig("openai");
  }
  if (explicit === "zai" && process.env.ZAI_API_KEY) {
    return makeConfig("zai");
  }
  // 未显式指定：按已配置 key 自动选
  if (process.env.ZAI_API_KEY) return makeConfig("zai");
  if (process.env.OPENAI_API_KEY) return makeConfig("openai");
  return undefined;
}

function makeConfig(provider: EmbeddingProvider): EmbeddingConfig {
  const def = PROVIDER_DEFAULTS[provider];
  const modelEnv = provider === "openai" ? process.env.OPENAI_EMBEDDING_MODEL : process.env.ZAI_EMBEDDING_MODEL;
  const apiKey = (provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ZAI_API_KEY)!;
  return {
    provider,
    model: modelEnv || def.model,
    baseUrl: def.baseUrl,
    apiKey,
    dim: def.dim,
  };
}

/** L2 归一化为单位向量（归一化后 sqlite-vec 的 L2 距离与余弦相似度单调等价）。 */
export function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector.slice();
  return vector.map((v) => v / norm);
}

export async function embed(text: string, config: EmbeddingConfig): Promise<EmbeddingResult> {
  const url = `${config.baseUrl}/embeddings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: text }),
  });

  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`embedding HTTP ${resp.status} from ${config.provider}: ${body}`);
  }

  const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
  const raw = json.data?.[0]?.embedding;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`embedding response missing data[0].embedding from ${config.provider}`);
  }

  return {
    vector: normalize(raw),
    dim: raw.length,
    provider: config.provider,
  };
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

/**
 * 向 SQLite 读写当前 embedding 维度与 provider，用于检测维度切换。
 * 维度不匹配（如从 GLM 1024 换到 OpenAI 1536）需要重建向量索引。
 */
export function loadEmbeddingMeta(db: Database.Database): { dim: number; provider: string } | undefined {
  db.exec(`CREATE TABLE IF NOT EXISTS rag_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare("SELECT value FROM rag_meta WHERE key = ?").get("embedding_meta") as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as { dim: number; provider: string };
  } catch {
    return undefined;
  }
}

export function saveEmbeddingMeta(db: Database.Database, config: EmbeddingConfig): void {
  const value = JSON.stringify({ dim: config.dim, provider: config.provider });
  db.prepare(
    "INSERT INTO rag_meta (key, value) VALUES ('embedding_meta', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(value);
}
