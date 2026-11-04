/**
 * 结构化压缩：在 Pi 的 session_before_compact 里用「任务状态 + 最近几轮对话」
 * 替换默认 LLM 摘要（用户批准的计划第 5 点；SDK 0.87.0 事实见 prd 记忆）。
 *
 * - 不再调一次 LLM：确定性模板拼接，省钱且可审计；
 * - 状态块复用每轮注入的 buildTaskStateInjection（自带「数据非指令」标注与限长）；
 * - previousSummary 并入（多次压缩不丢更早的结构化信息）；
 * - 回退策略：无 active 任务 / 任何异常 → 返回 undefined 走 SDK 默认压缩，
 *   **绝不 cancel**（压缩失败比摘要质量差严重得多）。
 *
 * 双入口注册：Web 在 createDietAgent 的 resourceLoader.extensionFactories，
 * TUI 在 diet-extension.ts（与 before_agent_start 同处）。
 */
import {
  convertToLlm,
  serializeConversation,
  type InlineExtension,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
} from "@earendil-works/pi-coding-agent";
import { getInjectableTask } from "./taskStateService.js";
import { buildTaskStateInjection } from "./taskStateInjection.js";

/** 最近对话摘尾的字符预算（serializeConversation 已把工具结果截到 2000 字）。 */
const RECENT_CONVERSATION_CHAR_BUDGET = 6_000;

export function buildStructuredCompactionSummary(
  stateBlock: string,
  conversationText: string,
  previousSummary?: string
): string {
  const previous = previousSummary?.trim()
    ? `【前次压缩摘要（已并入）】\n${previousSummary.trim()}\n\n`
    : "";
  const recentTail = conversationText.length > RECENT_CONVERSATION_CHAR_BUDGET
    ? `…（更早部分已省略）\n${conversationText.slice(-RECENT_CONVERSATION_CHAR_BUDGET)}`
    : conversationText;
  return [
    `${previous}${stateBlock}`,
    "【压缩前的最近对话（原文摘尾，供衔接语气与未完结话题）】",
    recentTail,
  ].join("\n\n");
}

/** 事件处理器：有 active 任务 → 结构化 summary；否则/异常 → undefined（默认压缩）。 */
export function structuredCompactionHandler(
  userId: string
): (event: SessionBeforeCompactEvent) => Promise<SessionBeforeCompactResult | undefined> {
  return async (event) => {
    try {
      const state = getInjectableTask(userId);
      if (!state) return undefined;
      const stateBlock = buildTaskStateInjection(state);
      if (!stateBlock) return undefined;
      const conversationText = serializeConversation(convertToLlm(event.preparation.messagesToSummarize));
      return {
        compaction: {
          summary: buildStructuredCompactionSummary(stateBlock, conversationText, event.preparation.previousSummary),
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: { structured: true, taskId: state.taskId },
        },
      };
    } catch {
      return undefined; // 任何异常走默认压缩，绝不 cancel
    }
  };
}

/** 注册用扩展工厂（Web resourceLoader.extensionFactories 与 TUI 共用）。 */
export function structuredCompactionExtension(userId: string): InlineExtension {
  return {
    name: `diet-structured-compaction:${userId}`,
    hidden: true,
    factory: (pi) => {
      const handler = structuredCompactionHandler(userId);
      pi.on("session_before_compact", (event) => handler(event));
    },
  };
}
