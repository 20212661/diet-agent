import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateLocalModelCache } from "../rag/localEmbedder.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("本地 embedding 缓存校验", () => {
  it("缺文件或过小文件判定为无效", async () => {
    const directory = mkdtempSync(join(tmpdir(), "diet-agent-cache-"));
    directories.push(directory);
    expect(await validateLocalModelCache(directory)).toBe(false);
    const modelDir = join(directory, "Xenova", "bge-small-zh-v1.5");
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "config.json"), "{}");
    expect(await validateLocalModelCache(directory)).toBe(false);
  });

  it("所有关键文件达到最小尺寸才视为有效", async () => {
    const directory = mkdtempSync(join(tmpdir(), "diet-agent-cache-"));
    directories.push(directory);
    const modelDir = join(directory, "Xenova", "bge-small-zh-v1.5");
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "config.json"), "x".repeat(100));
    writeFileSync(join(modelDir, "tokenizer_config.json"), "x".repeat(100));
    writeFileSync(join(modelDir, "tokenizer.json"), "x".repeat(10_000));
    writeFileSync(join(modelDir, "onnx", "model_quantized.onnx"), Buffer.alloc(1_000_000));
    expect(await validateLocalModelCache(directory)).toBe(true);
  });
});
