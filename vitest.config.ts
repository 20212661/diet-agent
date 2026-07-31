import { defineConfig } from "vitest/config";

/**
 * Vitest 配置
 *
 * - environment: node —— 测试涉及 SQLite、文件系统、顶层 await，需 Node 环境
 * - pool: forks —— 用子进程跑测试，与 better-sqlite3 原生绑定更稳
 * - coverage: 仅统计有可测逻辑的源码，排除纯类型 / 静态提示词常量 / TUI 渲染层
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/tests/**",
        "src/types/**",
        "src/agent/prompts/**",
        "src/tui/**",
        "src/utils/requestLogger.ts",
      ],
    },
  },
});
