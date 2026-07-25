/**
 * 饮食管理智能体 - 终端 TUI 聊天界面
 * 基于 @earendil-works/pi-tui
 */

import {
  TUI,
  Text,
  Input,
  Markdown,
  Loader,
  Box,
  Spacer,
  ProcessTerminal,
  matchesKey,
  type Component,
} from "@earendil-works/pi-tui";
import { sendDietAgentMessage } from "../agent/createDietAgent.js";

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

  // 创建终端和 TUI
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

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

  // 输入框
  const input = new Input();
  const inputBox = new Box(1, 0, (s) => `\x1b[48;5;235m${s}\x1b[0m`);
  inputBox.addChild(input);

  // 状态栏
  const statusText = new Text(
    gray(` ${bold("Ctrl+C")} 退出 │ ${bold("Enter")} 发送 │ 用户: ${cyan(user)} │ ${dim("diet-agent-tui")}`),
    0, 0
  );

  // 初始欢迎消息
  const welcomeText = [
    bold(cyan("🥗 饮食管理智能体 TUI")),
    "",
    "告诉我你吃了什么，我会帮你记录和分析！",
    "",
    gray("示例输入："),
    gray("  • 我午饭吃了宫保鸡丁盖饭"),
    gray("  • 今天吃得怎么样？"),
    gray("  • 帮我制定一个减脂食谱"),
    "",
  ].join("\n");

  const welcomeMd = new Markdown(welcomeText, 1, 0, chatMarkdownTheme);

  // 初始布局
  tui.addChild(welcomeMd);
  tui.addChild(messagesContainer);
  tui.addChild(loader);
  tui.addChild(inputBox);
  tui.addChild(statusText);

  // 停止 loader（仅在等待时显示）
  loader.stop();
  loader.setMessage("");

  // 聚焦到输入框
  tui.setFocus(input);

  // ─── API 调用 ──────────────────────────────────
  let isWaiting = false;

  async function sendMessage(text: string) {
    if (isWaiting || !text.trim()) return;

    isWaiting = true;

    // 添加用户消息气泡
    const userBubble = new ChatBubble("user", text);
    messagesContainer.addChild(userBubble);
    tui.requestRender();

    // 显示加载动画
    loader.setMessage("正在思考...");
    loader.start();
    tui.requestRender();

    try {
      // 直接调用 Agent，无需 HTTP 中转
      const result = await sendDietAgentMessage(user, text.trim());

      // 隐藏加载
      loader.stop();
      loader.setMessage("");

      // 添加 AI 回复气泡
      const reply = result.reply || "(无回复)";
      const aiBubble = new ChatBubble("assistant", reply);
      messagesContainer.addChild(aiBubble);
    } catch (err: any) {
      loader.stop();
      loader.setMessage("");

      const errMsg = err.message ?? String(err);
      const errBubble = new ChatBubble("system", `❌ 请求失败: ${errMsg}`);
      messagesContainer.addChild(errBubble);
    }

    isWaiting = false;
    tui.requestRender();
  }

  // ─── 输入处理 ──────────────────────────────────
  input.onSubmit = (value: string) => {
    const text = value.trim();
    if (!text) return;
    input.setValue("");
    sendMessage(text);
  };

  // 全局按键拦截
  tui.addInputListener((data: string) => {
    // Ctrl+C 退出
    if (matchesKey(data, "ctrl+c")) {
      tui.stop();
      process.exit(0);
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
