/**
 * 本地 embedding（transformers.js + bge-small-zh-v1.5）。
 *
 * 零 key、离线（首次下载后）、CPU 可跑。作为第三种 embedding provider，
 * 让无 API key 的用户（如只配 DeepSeek chat）也有向量语义召回。
 *
 * 模型首次从 HuggingFace Hub 下载（q8 量化 ~40MB），缓存到 data/model-cache（已 gitignore）。
 * 懒加载：首次 embed 时载入模型（~1-2s），之后常驻复用。BGE 推荐 mean pooling + L2 normalize，
 * 输出单位向量，与 sqlite-vec 的 L2 距离等价约定一致。
 */
import { pipeline, env } from "@huggingface/transformers";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "..", "data", "model-cache");
mkdirSync(CACHE_DIR, { recursive: true });

// 模型缓存到 data/model-cache；只用 HF Hub 远程模型，不读本地 ./models/
env.cacheDir = CACHE_DIR;
env.allowLocalModels = false;

const MODEL_ID = "Xenova/bge-small-zh-v1.5";
export const LOCAL_EMBEDDING_DIM = 512;

interface FeatureExtractor {
  (text: string, options: { pooling: "mean"; normalize: true }): Promise<{ data: Float32Array }>;
}

let _extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!_extractorPromise) {
    console.log(
      `[RAG-local] 首次加载 embedding 模型 ${MODEL_ID}（联网下载约 40MB，之后离线缓存）...`
    );
    _extractorPromise = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" }) as unknown as Promise<FeatureExtractor>;
  }
  return _extractorPromise;
}

export interface LocalEmbeddingResult {
  vector: number[]; // 已归一化（mean pooling + L2）
  dim: number;
}

export async function embedLocal(text: string): Promise<LocalEmbeddingResult> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const vector = Array.from(output.data);
  if (vector.length === 0) {
    throw new Error("local embedding 返回空向量");
  }
  return { vector, dim: vector.length };
}
