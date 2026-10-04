import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const npmEntry = process.env.npm_execpath;
if (!npmEntry) throw new Error("npm_execpath is unavailable; run this smoke test through npm run test:package");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "diet-agent-package-smoke-"));
let tarballPath;

function runNpm(args, options = {}) {
  return spawnSync(process.execPath, [npmEntry, ...args], { cwd: root, encoding: "utf8", ...options });
}

try {
  const packed = runNpm(["pack", "--json"]);
  if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.error ?? packed.stderr}`);
  const metadata = JSON.parse(packed.stdout);
  const packageMetadata = Array.isArray(metadata) ? metadata[0] : Object.values(metadata)[0];
  if (!packageMetadata?.filename) throw new Error(`npm pack returned no filename: ${packed.stdout}`);
  tarballPath = resolve(root, packageMetadata.filename);

  const isolatedNpmrc = join(temporaryDirectory, ".npmrc");
  const isolatedGlobalNpmrc = join(temporaryDirectory, "global.npmrc");
  writeFileSync(isolatedNpmrc, "ignore-scripts=true\n", "utf8");
  writeFileSync(isolatedGlobalNpmrc, "", "utf8");
  writeFileSync(join(temporaryDirectory, "package.json"), JSON.stringify({
    name: "diet-agent-package-smoke",
    private: true,
    allowScripts: {
      "better-sqlite3": false,
      esbuild: false,
      protobufjs: false,
      "onnxruntime-node": false,
    },
  }, null, 2), "utf8");
  const installEnv = { ...process.env };
  for (const key of Object.keys(installEnv)) {
    if (key.toLowerCase() === "npm_config_allow_scripts") delete installEnv[key];
  }
  installEnv.NPM_CONFIG_USERCONFIG = isolatedNpmrc;
  installEnv.NPM_CONFIG_GLOBALCONFIG = isolatedGlobalNpmrc;
  const installed = runNpm([
    "install", tarballPath, "--omit=optional", "--no-audit", "--no-fund",
  ], {
    cwd: temporaryDirectory,
    env: installEnv,
  });
  if (installed.status !== 0) throw new Error(`temporary npm install failed:\n${installed.error ?? installed.stderr}`);

  const packageRoot = join(temporaryDirectory, "node_modules", "diet-agent");
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (manifest.files.some((entry) => entry.startsWith("src"))) {
    throw new Error("published package unexpectedly includes src in files allowlist");
  }
  if (existsSync(join(temporaryDirectory, "node_modules", "@huggingface", "transformers"))) {
    throw new Error("optional local embedding dependency was installed by default");
  }

  const cli = join(packageRoot, "bin", "diet.js");
  const help = spawnSync(process.execPath, [cli, "--help"], {
    cwd: temporaryDirectory,
    encoding: "utf8",
  });
  if (help.status !== 0 || !help.stdout.includes("晚饭工作流")) {
    throw new Error(`installed CLI --help failed:\n${help.stdout}\n${help.stderr}`);
  }

  const cleanEnv = { ...process.env };
  for (const key of [
    "DEEPSEEK_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
    "MODEL_PROVIDER", "MODEL_ID",
  ]) delete cleanEnv[key];
  const startup = spawnSync(process.execPath, [cli, "--tui", `smoke_${Date.now()}`], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: cleanEnv,
    timeout: 15_000,
  });
  const startupOutput = `${startup.stdout}\n${startup.stderr}`;
  if (startup.status !== 1 || !startupOutput.includes("TUI 未启动")) {
    throw new Error(`installed CLI startup smoke returned an unexpected result:\n${startupOutput}`);
  }

  console.log(`Package smoke passed: ${basename(tarballPath)} installed and CLI checked.`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
  if (tarballPath?.startsWith(root)) rmSync(tarballPath, { force: true });
}
