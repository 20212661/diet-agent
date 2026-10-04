/** Only recover operations whose owner matches the current server user. */
export function createRecoveryStore(storage, userId, createOperationId) {
  if (typeof userId !== "string" || !userId) throw new Error("尚未读取当前用户，不能恢复或保存请求。");
  const prefix = `diet-agent:user:${encodeURIComponent(userId)}`;
  const chatKey = `${prefix}:pending-chat-request`;
  return {
    userId,
    chatKey,
    getPendingWrite(endpoint, payload) {
      const key = `${prefix}:pending-write:${endpoint}`;
      try {
        const existing = JSON.parse(storage.getItem(key) || "null");
        if (existing?.userId === userId && typeof existing.operationId === "string"
          && JSON.stringify(existing.payload) === JSON.stringify(payload)) return { key, ...existing };
      } catch {}
      const operation = { userId, operationId: createOperationId(), payload };
      storage.setItem(key, JSON.stringify(operation));
      return { key, ...operation };
    },
    loadChat() {
      try {
        const saved = JSON.parse(storage.getItem(chatKey) || "null");
        if (saved?.userId === userId && typeof saved.message === "string" && typeof saved.operationId === "string") {
          if (saved.status === "sending") saved.status = "result_uncertain";
          return saved;
        }
      } catch {}
      return null;
    },
    saveChat(request) {
      if (request.userId !== undefined && request.userId !== userId) throw new Error("请求所属用户已变化，请重新发送。");
      storage.setItem(chatKey, JSON.stringify({ ...request, userId }));
    },
  };
}
