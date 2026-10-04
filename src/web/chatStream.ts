import * as store from "../store/index.js";
import { sendDietAgentMessage } from "../agent/createDietAgent.js";
import { claimChatOperation, finishChatOperation, unresolvedChatEvent, type ChatOperationState, type ChatTerminalEvent } from "./chatOperationStore.js";

export function createChatOperationHandler(userId: string, sendMessage = sendDietAgentMessage) {
  interface ChatOperation {
    message: string;
    state: ChatOperationState;
    terminalEvent?: ChatTerminalEvent;
    writePossible: boolean;
    promise: Promise<void>;
  }
  const chatOperations = new Map<string, ChatOperation>();
  const WRITE_TOOL_NAMES = new Set([
    "log_meal", "edit_meal_log", "undo_meal_log", "update_user_profile", "update_kitchen_profile",
    "update_ingredient_inventory", "mark_ingredient_used", "generate_meal_plan", "generate_weekly_plan",
    "log_cooking_feedback", "generate_cooking_plan",
  ]);
  return async function streamChatOperation(
    operationId: string,
    message: string,
    retryFailedRequest: boolean,
    emit: (event: unknown) => void,
  ): Promise<void> {
    const key = `${userId}:chat:${operationId}`;
    let operation = chatOperations.get(key);
    if (operation && operation.message !== message) {
      emit({ type: "failed_before_write", status: "failed_before_write", reply: "这个请求 ID 已绑定到另一条消息。请编辑消息后重新发送。" });
      return;
    }
    if (operation && retryFailedRequest && operation.state === "failed_before_write") {
      operation = undefined;
    }
    if (operation) {
      await operation.promise;
      emit(operation.terminalEvent ?? unresolvedChatEvent());
      return;
    }

    const claim = claimChatOperation(store.getDatabase(), userId, operationId, message, retryFailedRequest);
    if (claim.kind === "message_conflict") {
      emit({ type: "failed_before_write", status: "failed_before_write", reply: "这个请求 ID 已绑定到另一条消息。请编辑消息后重新发送。" });
      return;
    }
    if (claim.kind === "existing") {
      emit(claim.terminalEvent ?? unresolvedChatEvent());
      return;
    }

    const next: ChatOperation = {
      message,
      state: "running",
      writePossible: false,
      promise: Promise.resolve(),
    };
    chatOperations.set(key, next);
    const publishTerminal = (event: ChatTerminalEvent) => {
      try {
        finishChatOperation(store.getDatabase(), userId, operationId, event);
        next.state = event.type;
        next.terminalEvent = event;
      } catch (error) {
        console.error("[WEB chat state]", error instanceof Error ? error.name : typeof error);
        next.state = "result_uncertain";
        next.terminalEvent = unresolvedChatEvent();
      }
      emit(next.terminalEvent);
    };
    next.promise = (async () => {
      emit({ type: "start", operationId });
      try {
        const result = await sendMessage(userId, message, {
          operationId,
          onTextDelta: (text) => emit({ type: "text", text }),
          onToolStatus: (tool) => {
            if (tool.phase === "pending" && WRITE_TOOL_NAMES.has(tool.toolName)) next.writePossible = true;
            emit({ type: "tool", ...tool });
          },
        });
        if (result.status === "verification_required") {
          publishTerminal({
            type: "result_uncertain",
            status: "result_uncertain",
            reply: result.reply,
            sessionId: result.sessionId,
            refreshedData: result.refreshedData,
          });
        } else {
          publishTerminal({ type: "done", status: "done", reply: result.reply, sessionId: result.sessionId });
        }
      } catch (error) {
        console.error("[WEB chat]", error instanceof Error ? error.name : typeof error);
        if (next.writePossible) {
          publishTerminal({
            type: "result_uncertain",
            status: "result_uncertain",
            reply: "写入操作可能已经完成，但回复中断。我已刷新资料，请核对相关记录后再继续；系统不会自动重发。",
          });
        } else {
          publishTerminal({
            type: "failed_before_write",
            status: "failed_before_write",
            reply: "请求在发生写入前失败。你可以编辑后重试，或使用同一请求安全重试。",
          });
        }
      }
    })();
    try {
      await next.promise;
    } finally {
      if (chatOperations.get(key) === next) chatOperations.delete(key);
    }
  }

}
