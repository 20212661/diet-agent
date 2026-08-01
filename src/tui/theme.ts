/**
 * TUI 共享主题：ANSI 颜色辅助 + Markdown 渲染主题。
 *
 * 抽出独立文件，供 chat-tui 与 profilePanel 共用。
 * 关键：避免 profilePanel 反向 import chat-tui —— 否则会顺带拖入
 * sendDietAgentMessage → 整个 agent（LLM / 向量 / 会话）重依赖。
 */

// ─── ANSI 颜色辅助 ──────────────────────────────────
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Markdown 主题 ──────────────────────────────────
export const chatMarkdownTheme = {
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
