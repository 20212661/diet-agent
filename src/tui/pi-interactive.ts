import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  InteractiveMode,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { resolveModelCandidates, wrapToolsForUser } from "../agent/modelAdapter.js";
import {
  dietAgentTools,
  getConfiguredModelRuntime,
  getSessionDirForUser,
} from "../agent/createDietAgent.js";
import { GLM_STRICT_COOKING_AGENT_PROMPT, buildUserMemoryPrompt } from "../agent/systemPrompt.js";
import * as store from "../store/index.js";
import { createDietExtension } from "./diet-extension.js";

export async function startPiInteractiveApp(userId: string): Promise<void> {
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const candidates = resolveModelCandidates();
  const primary = candidates.find((candidate) => candidate.model);
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: sessionCwd, agentDir: sessionAgentDir, sessionManager }) => {
    const modelRuntime = await getConfiguredModelRuntime();
    const settingsManager = SettingsManager.create(sessionCwd, sessionAgentDir);
    const savedProvider = settingsManager.getDefaultProvider();
    const savedModel = settingsManager.getDefaultModel();
    const selected = candidates.find((candidate) =>
      candidate.model?.provider === savedProvider && candidate.model?.id === savedModel
    ) ?? primary;
    const resourceLoaderOptions = {
      extensionFactories: [createDietExtension(userId)],
      systemPromptOverride: () => [
        GLM_STRICT_COOKING_AGENT_PROMPT,
        selected?.promptPatch ?? "",
        buildUserMemoryPrompt(userId),
        [
          "## 当前用户 ID",
          `当前用户 ID 是：${userId}`,
          `所有饮食工具调用的 userId 必须严格使用：${userId}`,
        ].join("\n"),
      ].filter(Boolean).join("\n\n"),
      noContextFiles: true,
    };
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir: sessionAgentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions,
    });
    const { session, extensionsResult, modelFallbackMessage } = await createAgentSessionFromServices({
      services,
      sessionManager,
      noTools: "builtin",
      customTools: wrapToolsForUser(userId, dietAgentTools),
      ...(selected?.model ? { model: selected.model } : {}),
      ...(candidates.some((candidate) => candidate.model)
        ? { scopedModels: candidates.flatMap((candidate) => candidate.model ? [{ model: candidate.model }] : []) }
        : {}),
    });
    return {
      session,
      extensionsResult,
      services,
      diagnostics: services.diagnostics,
      ...(modelFallbackMessage ? { modelFallbackMessage } : {}),
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.continueRecent(cwd, getSessionDirForUser(userId)),
  });

  // Pi 的交互应用原生负责会话、命令、模型选择、编辑器、状态栏和工具渲染。
  const app = new InteractiveMode(runtime, { verbose: true });
  try {
    await app.run();
  } finally {
    await runtime.dispose();
    store.closeDatabase();
  }
}
