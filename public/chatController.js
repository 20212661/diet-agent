import { createRecoveryStore } from "./recoveryStore.js";

export function createChatController({ $, esc, getData, getCurrentPage, toast, renderPage, refreshData, modelStatusLabel, clientOperationId, useSlash, slashCommands }) {
  let recoveryStore = null;
  let pendingChatStorageKey = null;
  let pendingChatRequest = null;
  let activeChatAssistant = null;
  const activeTools = new Map();
  const chatMessages = $("#chat-messages");
  const chatInput = $("#chat-input");
  function getPendingWrite(endpoint, payload) {
    if (!recoveryStore || recoveryStore.userId !== getData()?.userId) throw new Error("当前用户尚未就绪，请刷新后重试。");
    return recoveryStore.getPendingWrite(endpoint, payload);
  }
  function bindRecoveryUser(userId) {
    if (recoveryStore?.userId === userId) return;
    const switching = recoveryStore !== null;
    recoveryStore = createRecoveryStore(localStorage, userId, clientOperationId);
    pendingChatStorageKey = recoveryStore.chatKey;
    pendingChatRequest = recoveryStore.loadChat();
    activeChatAssistant = null;
    if (switching) { chatMessages.replaceChildren(); chatInput.value = ""; activeTools.clear(); }
    chatInput.disabled = false;
    $(".send-button").disabled = false;
    restorePendingChat();
  }
  function addMessage(kind, text = "") {
    const node = document.createElement("div");
    node.className = `message ${kind}`;
    node.textContent = text;
    chatMessages.append(node);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return node;
  }
  async function sendChat(message) {
    return runChatRequest(message);
  }
  async function runChatRequest(message, existingRequest = null, retryFailedRequest = false) {
    if (!recoveryStore || recoveryStore.userId !== getData()?.userId) { toast("请等待当前用户资料加载后再发送。"); return; }
    if (existingRequest?.userId && existingRequest.userId !== getData().userId) { toast("请求所属用户已变化，请重新发送。"); return; }
    const clean = existingRequest?.message ?? message.trim();
    if (!clean) return;
    if (!existingRequest && clean.startsWith("/") && !clean.includes(" ")) {
      const command = slashCommands.find((item) => item.command === clean);
      if (command) { useSlash(clean); return; }
    }
    $(".welcome-message")?.remove();
    const pending = existingRequest ?? { userId: getData().userId, operationId: clientOperationId(), message: clean, status: "sending" };
    pending.status = "sending";
    pendingChatRequest = pending;
    savePendingChatRequest(pending);
    if (!existingRequest || !activeChatAssistant) addMessage("user", clean);
    const assistant = activeChatAssistant ?? addMessage("assistant", "");
    activeChatAssistant = assistant;
    assistant.className = "message assistant";
    assistant.replaceChildren();
    assistant.textContent = "正在发送…";
    const sendButton = $(".send-button");
    const sendLabel = sendButton.textContent;
    sendButton.disabled = true;
    sendButton.textContent = "…";
    chatInput.value = clean;
    chatInput.disabled = true;
    $("#agent-status").textContent = "正在发送";
    activeTools.clear();
    renderToolActivity();
    let terminalStatus = "";
    const showTerminal = async (event) => {
      if (pending.userId !== getData()?.userId) return;
      terminalStatus = event.status ?? event.type;
      assistant.replaceChildren();
      assistant.textContent = event.reply ?? "";
      if (event.type === "done") {
        pendingChatRequest = null;
        localStorage.removeItem(pendingChatStorageKey);
        activeChatAssistant = null;
        if (chatInput.value === clean) chatInput.value = "";
        chatInput.disabled = false;
        return;
      }
      pending.status = event.type;
      pendingChatRequest = pending;
      savePendingChatRequest(pending);
      assistant.classList.add("error");
      renderChatRecovery(assistant, pending, event.type);
      if (event.type === "result_uncertain") await refreshData();
      chatInput.disabled = true;
    };
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Diet-User-Id": encodeURIComponent(pending.userId) },
        body: JSON.stringify({ message: clean, operationId: pending.operationId, retry: retryFailedRequest }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        const error = new Error(result.error || "请求未被服务器接受。");
        error.confirmedNotStarted = true;
        throw error;
      }
      if (!response.body) throw new Error("服务器没有返回请求状态。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleEvent = async (event) => {
        if (pending.userId !== getData()?.userId) return;
        if (event.type === "text") { assistant.textContent = event.text; chatMessages.scrollTop = chatMessages.scrollHeight; }
        if (event.type === "tool") {
          activeTools.set(event.toolName, event.phase);
          if (event.toolName === "generate_cooking_plan" && event.phase === "success" && /(?:^|,)status=matched(?:,|$)/.test(event.outcome ?? "")) {
            try { localStorage.setItem(`diet-agent:onboarding:first-dinner:${getData()?.userId}`, "true"); } catch {}
            if (getCurrentPage() === "overview") renderPage();
          }
          renderToolActivity();
        }
        if (["done", "failed_before_write", "result_uncertain"].includes(event.type)) await showTerminal(event);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          try { await handleEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
      if (buffer.trim()) {
        const line = buffer.split("\n").find((part) => part.startsWith("data: "));
        if (line) { try { await handleEvent(JSON.parse(line.slice(6))); } catch {} }
      }
      if (!terminalStatus) throw new Error("连接中断，尚未收到请求终态。");
      if (activeTools.size) setTimeout(() => { refreshData(); renderToolActivity(); }, 250);
    } catch (error) {
      if (terminalStatus) return;
      const confirmedNotStarted = error?.confirmedNotStarted === true;
      const type = confirmedNotStarted ? "failed_before_write" : "result_uncertain";
      await showTerminal({
        type,
        status: type,
        reply: confirmedNotStarted
          ? "请求未被服务器接受，因此没有发生工具写入。你可以编辑后重试，或安全地重试原请求。"
          : "连接中断，暂时无法确认请求结果。我已刷新仪表盘；请核对相关记录。系统不会自动重发。",
      });
    } finally {
      if (pending.userId !== getData()?.userId) return;
      const unresolved = pendingChatRequest === pending;
      sendButton.disabled = unresolved;
      sendButton.textContent = sendLabel;
      if (unresolved) $("#agent-status").textContent = pending.status === "failed_before_write" ? "发送失败，可安全重试" : "结果待核对";
      else $("#agent-status").textContent = modelStatusLabel();
      if (!unresolved) chatInput.disabled = false;
      renderToolActivity(true);
    }
  }

  function savePendingChatRequest(request) {
    if (!recoveryStore || recoveryStore.userId !== getData()?.userId) throw new Error("请求所属用户已变化，请刷新后重试。");
    recoveryStore.saveChat(request);
  }
  function renderChatRecovery(assistant, request, status) {
    const controls = document.createElement("div");
    controls.className = "chat-recovery-actions";
    const addAction = (label, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = label;
      button.addEventListener("click", action);
      controls.append(button);
    };
    if (status === "failed_before_write") {
      addAction("一键安全重试", () => runChatRequest(request.message, request, true));
      addAction("编辑后重试", () => {
        pendingChatRequest = null;
        localStorage.removeItem(pendingChatStorageKey);
        activeChatAssistant = null;
        chatInput.value = request.message;
        chatInput.disabled = false;
        $(".send-button").disabled = false;
        $("#agent-status").textContent = "已就绪";
        chatInput.focus();
      });
    } else {
      addAction("重新连接并查询本次结果", () => runChatRequest(request.message, request, false));
      addAction("我已核对记录，开始新消息", () => {
        pendingChatRequest = null;
        localStorage.removeItem(pendingChatStorageKey);
        activeChatAssistant = null;
        chatInput.value = "";
        chatInput.disabled = false;
        $(".send-button").disabled = false;
        $("#agent-status").textContent = "已就绪";
        chatInput.focus();
      });
    }
    assistant.append(document.createElement("br"), controls);
  }
  function restorePendingChat() {
    if (!pendingChatRequest) return;
    chatInput.value = pendingChatRequest.message;
    addMessage("user", pendingChatRequest.message);
    activeChatAssistant = addMessage("assistant", "");
    const status = pendingChatRequest.status === "failed_before_write" ? "failed_before_write" : "result_uncertain";
    pendingChatRequest.status = status;
    activeChatAssistant.textContent = status === "failed_before_write"
      ? "上次请求确认在写入前失败。可以安全重试或编辑后重试。"
      : "上次请求结果尚未确认。请核对相关记录，或重新连接查询本次结果。系统不会自动重发。";
    activeChatAssistant.classList.add("error");
    renderChatRecovery(activeChatAssistant, pendingChatRequest, status);
    chatInput.disabled = true;
    $(".send-button").disabled = true;
    $("#agent-status").textContent = status === "failed_before_write" ? "发送失败，可安全重试" : "结果待核对";
    savePendingChatRequest(pendingChatRequest);
  }
  function renderToolActivity(clear = false) {
    const node = $("#tool-activity");
    if (clear && !activeTools.size) { node.hidden = true; return; }
    node.hidden = activeTools.size === 0;
    node.innerHTML = [...activeTools.entries()].map(([name, phase]) => `<span>${phase === "pending" ? "◌" : phase === "error" ? "!" : "✓"} ${esc(name)}</span>`).join("");
  }

  function statusLabel() {
    return pendingChatRequest ? (pendingChatRequest.status === "failed_before_write" ? "发送失败，可安全重试" : "结果待核对") : modelStatusLabel();
  }
  return { sendChat, bindRecoveryUser, getPendingWrite, statusLabel };
}
