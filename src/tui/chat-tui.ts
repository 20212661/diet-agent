/**
 * 饮食管理智能体 - 终端 TUI 聊天界面
 * 基于 @earendil-works/pi-tui
 */

import {
  type TUI,
  TuiMainScreen,
  Text,
  Editor,
  CombinedAutocompleteProvider,
  Markdown,
  Loader,
  Box,
  Spacer,
  ProcessTerminal,
  matchesKey,
  type Component,
} from "@earendil-works/pi-tui";
import {
  clearUserAgentSession,
  disposeAllAgentSessions,
  sendDietAgentMessage,
} from "../agent/createDietAgent.js";
import { checkModelConfiguration, formatModelCheckResult } from "../agent/configDoctor.js";
import { resolveModelRequests } from "../agent/modelAdapter.js";
import * as store from "../store/index.js";
import { deleteUserData, exportUserData, getBackupRetentionPolicy, getUserDataOverview } from "../privacy/userData.js";
import { flushPendingRequestLogs } from "../utils/requestLogger.js";

// ─── ANSI 颜色辅助 ──────────────────────────────────
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Markdown 主题 ──────────────────────────────────
const chatMarkdownTheme = {
  heading: (t: string) => bold(cyan(t)),
  link: (t: string) => cyan(t),
  linkUrl: (t: string) => gray(t),
  code: (t: string) => yellow(t),
  codeBlock: (t: string) => `\x1b[48;5;236m${t}\x1b[0m`,
  codeBlockBorder: (t: string) => gray(t),
  quote: (t: string) => `\x1b[32m${t}\x1b[0m`,
  quoteBorder: (t: string) => green(t),
  hr: (t: string) => gray(t),
  listBullet: (t: string) => green(t),
  bold: (t: string) => bold(t),
  italic: (t: string) => `\x1b[3m${t}\x1b[0m`,
  strikethrough: (t: string) => `\x1b[9m${t}\x1b[0m`,
  underline: (t: string) => `\x1b[4m${t}\x1b[0m`,
};

// ─── 配置 ──────────────────────────────────────────
const DEFAULT_USER = process.env.USER_ID ?? "tui_user";

interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

// ─── 消息气泡组件 ──────────────────────────────────
class ChatBubble implements Component {
  private cachedLines: string[] = [];
  private cachedWidth = 0;

  constructor(
    private role: "user" | "assistant" | "system",
    private content: string
  ) {}

  invalidate() {
    this.cachedWidth = 0;
  }

  setContent(content: string) {
    this.content = content;
    this.cachedLines = [];
    this.invalidate();
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedLines.length > 0) {
      return this.cachedLines;
    }
    this.cachedWidth = width;

    const maxWidth = Math.min(width - 2, 80);
    const lines: string[] = [];

    // 头部标签
    if (this.role === "user") {
      lines.push(green("🧑 你"));
    } else if (this.role === "assistant") {
      lines.push(cyan("🤖 饮食助手"));
    } else {
      lines.push(yellow("ℹ️ 系统"));
    }

    // 内容：使用 Markdown 渲染
    const md = new Markdown(this.content, 2, 0, chatMarkdownTheme);
    const rendered = md.render(maxWidth);
    lines.push(...rendered);

    // 底部分隔
    lines.push(gray("─".repeat(Math.min(width, 60))));
    lines.push("");

    this.cachedLines = lines;
    return lines;
  }
}

// ─── 主 TUI 应用 ──────────────────────────────────
export async function startChatTUI(userId?: string) {
  const user = userId ?? DEFAULT_USER;
  const modelRequests = resolveModelRequests();
  const activeModel = modelRequests[0]
    ? `${modelRequests[0].provider}/${modelRequests[0].modelId}`
    : "SDK default";

  // 创建终端和 TUI
  const terminal = new ProcessTerminal();
  const tui: TUI = new TuiMainScreen(terminal);

  // 聊天消息容器
  const messagesContainer = new Box(0, 0);

  // 加载指示器
  const loader = new Loader(
    tui,
    (s) => cyan(s),
    (s) => dim(s),
    "正在思考...",
    { frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], intervalMs: 80 }
  );

  // 编辑器内置斜杠命令自动补全：输入 / 后可搜索、浏览命令及说明。
  const editor = new Editor(tui, {
    borderColor: gray,
    selectList: {
      selectedPrefix: (s) => cyan(s),
      selectedText: (s) => bold(cyan(s)),
      description: (s) => gray(s),
      scrollInfo: (s) => dim(s),
      noMatch: (s) => gray(s),
    },
  }, { paddingX: 1, autocompleteMaxVisible: 6 });
  const slashCommands = [
    { name: "doctor", description: "检查认证、模型和网络状态" },
    { name: "model", description: "查看当前候选模型顺序" },
    { name: "profile", description: "查看饮食画像和厨房设备" },
    { name: "data", description: "查看当前用户本地数据概览" },
    { name: "clear", description: "清空当前界面和对话上下文" },
    { name: "export", description: "导出当前用户数据和对话" },
    { name: "delete-data", description: "预览并确认删除当前用户数据" },
    { name: "help", description: "显示可用命令" },
    { name: "quit", description: "安全退出饮食助手" },
  ];
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands, process.cwd()));

  // 状态栏
  const statusText = new Text(
    gray(` ${bold("Ctrl+C")} 退出 │ ${bold("Enter")} 发送 │ 用户: ${cyan(user)} │ 模型: ${cyan(activeModel)}`),
    0, 0
  );

  // 初始欢迎消息
  const welcomeText = [
    bold(cyan("🥗 饮食管理智能体 TUI")),
    "",
    "告诉我你吃了什么，我会帮你记录和分析！",
    `当前模型：${activeModel}`,
    "",
    gray("示例输入："),
    gray("  • 我午饭吃了宫保鸡丁盖饭"),
    gray("  • 今天吃得怎么样？"),
    gray("  • 帮我制定一个减脂食谱"),
    gray("输入 / 打开命令列表，继续输入可筛选；↑↓ 选择，Enter 补全或执行。"),
    "",
  ].join("\n");

  const welcomeMd = new Markdown(welcomeText, 1, 0, chatMarkdownTheme);

  // 初始布局
  tui.addChild(welcomeMd);
  tui.addChild(messagesContainer);
  tui.addChild(loader);
  tui.addChild(editor);
  tui.addChild(statusText);

  // 停止 loader（仅在等待时显示）
  loader.stop();
  loader.setMessage("");

  // 聚焦到输入框
  tui.setFocus(editor);

  // ─── API 调用 ──────────────────────────────────
  let isWaiting = false;
  const transcript: TranscriptEntry[] = [];
  let deleteConfirmationExpiresAt = 0;

  function addBubble(role: TranscriptEntry["role"], content: string, record = true): ChatBubble {
    const bubble = new ChatBubble(role, content);
    messagesContainer.addChild(bubble);
    if (record) transcript.push({ role, content, createdAt: new Date().toISOString() });
    return bubble;
  }

  function shutdown(exitCode = 0): never {
    loader.stop();
    tui.stop();
    disposeAllAgentSessions();
    store.closeDatabase();
    process.exit(exitCode);
  }

  function dataOverviewText(): string {
    const overview = getUserDataOverview(user);
    const dbCount = Object.entries(overview.database).map(([key, value]) => `  - ${key}: ${value}`).join("\n");
    return [
      "此用户本机数据概览：",
      `数据库记录：\n${dbCount}`,
      `会话文件：${overview.sessionFiles}`,
      `当前终端消息：${transcript.length} 条（/export 时一并包含）`,
      `已生成导出文件：${overview.exportFiles}`,
      `请求诊断日志：${overview.requestLogFiles}`,
      `全局迁移备份：${overview.migrationBackups}（删除时会逐份清除此用户的数据库记录）`,
      getBackupRetentionPolicy(),
      "命令：/export 导出数据；/delete-data 预览并确认删除。",
    ].join("\n");
  }

  async function handleSlashCommand(value: string): Promise<boolean> {
    if (!value.startsWith("/")) return false;
    const command = value.split(/\s+/, 1)[0].toLowerCase();
    if (command === "/quit") shutdown(0);
    if (command === "/doctor") {
      addBubble("system", formatModelCheckResult(await checkModelConfiguration()));
    } else if (command === "/model") {
      const requests = resolveModelRequests();
      addBubble("system", requests.length
        ? `当前候选模型：\n${requests.map((item, index) => `${index + 1}. ${item.provider}/${item.modelId}`).join("\n")}`
        : "当前使用 SDK default；未检测到显式供应商候选。");
    } else if (command === "/profile") {
      const profile = store.getUserProfile(user);
      const kitchen = store.getKitchenProfile(user);
      addBubble("system", [
        "当前画像：",
        `- 目标：${profile?.goal ?? "未设置"}`,
        `- 忌口：${profile?.avoidFoods?.join("、") || "无"}`,
        `- 过敏：${profile?.allergies?.join("、") || "无"}`,
        `- 厨房：${kitchen.burners} 个灶眼，烤箱${kitchen.hasOven ? "有" : "无"}，微波炉${kitchen.hasMicrowave ? "有" : "无"}，电饭煲${kitchen.hasRiceCooker ? "有" : "无"}`,
      ].join("\n"));
    } else if (command === "/clear") {
      clearUserAgentSession(user);
      messagesContainer.clear();
      transcript.length = 0;
      addBubble("system", "已清空当前界面和该用户的持久化对话上下文。", false);
    } else if (command === "/data") {
      addBubble("system", dataOverviewText(), false);
    } else if (command === "/export") {
      try {
        await flushPendingRequestLogs();
        addBubble("system", `用户数据与当前对话已导出为 JSON：${exportUserData(user, transcript)}`, false);
      } catch (error) {
        addBubble("system", `导出失败：${error instanceof Error ? error.message : String(error)}`, false);
      }
    } else if (command === "/delete-data") {
      if (value.trim().toUpperCase() === "/DELETE-DATA CONFIRM" && Date.now() < deleteConfirmationExpiresAt) {
        deleteConfirmationExpiresAt = 0;
        try {
          await flushPendingRequestLogs();
          const result = deleteUserData(user, () => clearUserAgentSession(user));
          messagesContainer.clear();
          transcript.length = 0;
          addBubble("system", [
            "✅ 已删除当前用户数据。",
            `数据库记录：${result.databaseRows}；会话文件：${result.sessionFiles}；导出文件：${result.exportFiles}；诊断日志：${result.requestLogFiles}；已清理迁移备份：${result.backupsScrubbed}。`,
            ...(result.backupErrors ? [`⚠️ ${result.backupErrors} 份备份未能清理，请检查权限或磁盘状态并重试。`] : []),
            "应用重启后仍会保持删除。",
          ].join("\n"), false);
        } catch (error) {
          addBubble("system", `删除未完成：${error instanceof Error ? error.message : String(error)}。请检查错误后重试。`, false);
        }
      } else {
        deleteConfirmationExpiresAt = Date.now() + 2 * 60 * 1000;
        addBubble("system", [
          dataOverviewText(),
          "删除会清除上述用户数据，并从现存迁移备份中移除此用户的数据库记录。",
          "如确认，请在 2 分钟内再次输入：/delete-data CONFIRM",
        ].join("\n"), false);
      }
    } else if (command === "/help") {
      addBubble("system", "可用命令：/doctor /model /profile /data /clear /export /delete-data /quit");
    } else {
      addBubble("system", `未知命令：${command}。输入 /help 查看可用命令。`);
    }
    tui.requestRender();
    return true;
  }

  async function sendMessage(text: string) {
    if (isWaiting || !text.trim()) return;

    if (text.trim().startsWith("/")) {
      isWaiting = true;
      try {
        await handleSlashCommand(text.trim());
      } finally {
        loader.stop();
        loader.setMessage("");
        isWaiting = false;
        tui.requestRender();
      }
      return;
    }

    isWaiting = true;

    // 添加用户消息气泡
    addBubble("user", text);
    tui.requestRender();

    // 显示加载动画
    loader.setMessage("正在思考...");
    loader.start();
    tui.requestRender();

    let aiBubble: ChatBubble | undefined;
    let streamedText = "";
    try {
      // 直接调用 Agent，无需 HTTP 中转
      const result = await sendDietAgentMessage(user, text.trim(), {
        onTextDelta(currentText) {
          streamedText = currentText;
          loader.stop();
          loader.setMessage("");
          if (!aiBubble) aiBubble = addBubble("assistant", currentText, false);
          else aiBubble.setContent(currentText);
          tui.requestRender();
        },
        onToolStatus(status) {
          const labels: Record<string, string> = {
            log_meal: "记录饮食", edit_meal_log: "更正饮食记录", undo_meal_log: "撤销饮食记录",
            update_user_profile: "更新长期饮食画像", update_ingredient_inventory: "更新食材库存",
            generate_weekly_plan: "生成一周菜单", generate_cooking_plan: "生成做饭计划",
          };
          const label = labels[status.toolName] ?? status.toolName;
          if (status.phase === "pending") {
            statusText.setText(status.toolName === "update_user_profile"
              ? yellow(` 待确认：${label} │ 请检查确认窗口中的变更内容`)
              : gray(` 正在执行：${label}`));
          } else if (status.phase === "error") {
            statusText.setText(yellow(` 操作失败：${label} │ 请查看错误原因`));
          } else if (status.outcome?.includes("confirmationRequired=true")) {
            statusText.setText(yellow(` 等待确认：${label}`));
          } else if (status.outcome?.includes("clarificationRequired=true")) {
            statusText.setText(yellow(` 等待补充信息：${label}`));
          } else if (status.outcome?.includes("saved=false") || status.outcome?.includes("cancelled=true")) {
            statusText.setText(gray(` 未写入：${label}`));
          } else {
            statusText.setText(green(` 操作完成：${label}`));
          }
          tui.requestRender();
        },
      });

      // 添加 AI 回复气泡
      const reply = result.reply || "(无回复)";
      if (!aiBubble) aiBubble = addBubble("assistant", reply, false);
      else aiBubble.setContent(reply);
      transcript.push({ role: "assistant", content: reply, createdAt: new Date().toISOString() });
    } catch (err: any) {
      const errMsg = err.message ?? String(err);
      if (aiBubble && streamedText) aiBubble.setContent(`${streamedText}\n\n⚠️ 响应中断`);
      addBubble("system", `❌ 请求失败: ${errMsg}`);
    } finally {
      loader.stop();
      loader.setMessage("");
      isWaiting = false;
      tui.requestRender();
    }
  }

  // ─── 输入处理 ──────────────────────────────────
  editor.onSubmit = (value: string) => {
    const text = value.trim();
    if (!text) return;
    editor.setText("");
    sendMessage(text);
  };

  // 全局按键拦截
  tui.addInputListener((data: string) => {
    // Ctrl+C 退出
    if (matchesKey(data, "ctrl+c")) {
      shutdown(0);
    }
    return undefined;
  });

  // 设置窗口标题
  terminal.setTitle("🥗 饮食管理智能体");

  // 启动
  console.clear();
  tui.start();

  console.log(bold(cyan("\n🥗 饮食管理智能体 TUI 已启动")));
  console.log(gray(`   用户: ${user} │ 按 Ctrl+C 退出\n`));
}
