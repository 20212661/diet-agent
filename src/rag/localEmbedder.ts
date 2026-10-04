import { constants } from "node:fs";
import { access, mkdir, open, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const LOCAL_MODEL_CACHE_DIR = join(moduleDir, "..", "..", "data", "model-cache");
const MODEL_RELATIVE_DIR = join("Xenova", "bge-small-zh-v1.5");
const MODEL_ID = "Xenova/bge-small-zh-v1.5";
const DOWNLOAD_LOCK = join(LOCAL_MODEL_CACHE_DIR, ".bge-small-zh-v1.5.download.lock");
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 2 * 60_000;
export const LOCAL_EMBEDDING_DIM = 512;

const requiredCacheFiles = [
  ["config.json", 100],
  ["tokenizer_config.json", 100],
  ["tokenizer.json", 10_000],
  [join("onnx", "model_quantized.onnx"), 1_000_000],
] as const;

interface FeatureExtractor {
  (text: string, options: { pooling: "mean"; normalize: true }): Promise<{ data: Float32Array }>;
}

let extractorPromise: Promise<FeatureExtractor> | undefined;

export async function validateLocalModelCache(cacheDir = LOCAL_MODEL_CACHE_DIR): Promise<boolean> {
  const modelDir = join(cacheDir, MODEL_RELATIVE_DIR);
  try {
    for (const [relativePath, minimumBytes] of requiredCacheFiles) {
      const info = await stat(join(modelDir, relativePath));
      if (!info.isFile() || info.size < minimumBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function offlineRequested(): boolean {
  return [process.env.DIET_AGENT_OFFLINE, process.env.HF_HUB_OFFLINE, process.env.TRANSFORMERS_OFFLINE]
    .some((value) => value === "1" || value?.toLowerCase() === "true");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireDownloadLock(): Promise<{ owner: boolean; handle?: FileHandle }> {
  await mkdir(LOCAL_MODEL_CACHE_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const handle = await open(DOWNLOAD_LOCK, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return { owner: true, handle };
    } catch (error) {
      const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "EEXIST") throw error;
      if (await validateLocalModelCache()) return { owner: false };
      try {
        const lockInfo = await stat(DOWNLOAD_LOCK);
        if (Date.now() - lockInfo.mtimeMs > LOCK_STALE_MS) {
          await unlink(DOWNLOAD_LOCK);
          continue;
        }
      } catch {
        continue;
      }
      await delay(500);
    }
  }
  throw new Error("等待本地 embedding 模型下载超时；请确认没有其他 diet-agent 进程正在下载模型。");
}

async function releaseDownloadLock(lock: { owner: boolean; handle?: FileHandle }): Promise<void> {
  if (!lock.owner) return;
  await lock.handle?.close();
  try {
    await access(DOWNLOAD_LOCK, constants.F_OK);
    await unlink(DOWNLOAD_LOCK);
  } catch {
    // Lock already removed.
  }
}

async function loadExtractor(): Promise<FeatureExtractor> {
  const cacheValid = await validateLocalModelCache();
  if (!cacheValid && offlineRequested()) {
    throw new Error(
      "本地 embedding 缓存不完整且当前为离线模式。请联网运行一次，或设置 EMBEDDING_PROVIDER=off 使用默认 FTS5。"
    );
  }

  let transformers: typeof import("@huggingface/transformers");
  try {
    transformers = await import("@huggingface/transformers");
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ERR_MODULE_NOT_FOUND" || String(error).includes("@huggingface/transformers")) {
      throw new Error(
        "本地向量能力未安装。运行 npm install @huggingface/transformers，或设置 EMBEDDING_PROVIDER=off 使用 FTS5。"
      );
    }
    throw error;
  }

  await mkdir(LOCAL_MODEL_CACHE_DIR, { recursive: true });
  transformers.env.cacheDir = LOCAL_MODEL_CACHE_DIR;
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = !offlineRequested();

  const lock = cacheValid ? { owner: false } : await acquireDownloadLock();
  try {
    if (!cacheValid && lock.owner) {
      console.log(`[RAG-local] 正在下载 ${MODEL_ID}；其他进程会等待同一下载锁...`);
    }
    const extractor = await transformers.pipeline("feature-extraction", MODEL_ID, { dtype: "q8" }) as unknown as FeatureExtractor;
    if (!(await validateLocalModelCache())) {
      throw new Error("本地 embedding 模型缓存校验失败；请检查磁盘空间或清理损坏缓存后重试。");
    }
    return extractor;
  } finally {
    await releaseDownloadLock(lock);
  }
}

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = loadExtractor().catch((error) => {
      extractorPromise = undefined;
      throw error;
    });
  }
  return extractorPromise;
}

export interface LocalEmbeddingResult {
  vector: number[];
  dim: number;
}

export async function embedLocal(text: string): Promise<LocalEmbeddingResult> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const vector = Array.from(output.data);
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("local embedding 返回了无效向量");
  }
  return { vector, dim: vector.length };
}
