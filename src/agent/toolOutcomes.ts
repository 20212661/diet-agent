/**
 * 工具结果的状态归纳：只输出可安全写日志/trace 的状态码，不含参数值或敏感结果。
 * createDietAgent 的写入判定与 traceRecorder 的 span 状态共用这一份实现。
 */

/** 判断写工具的 result 是否表示数据确已保存（用于决定是否需要人工核对）。 */
export function toolResultIndicatesSuccess(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return true;
  const outcome = details as Record<string, unknown>;
  return outcome.saved !== false && outcome.undone !== false && outcome.clarificationRequired !== true && outcome.notFound !== true
    && outcome.status !== "no_match";
}

/** 把工具结果归纳为不含敏感内容的状态串，用于日志和 trace span。 */
export function safeToolOutcome(result: unknown, isError: boolean): string {
  if (isError) return "error";
  if (!result || typeof result !== "object") return "completed";
  const top = result as Record<string, unknown>;
  const detail = top.details && typeof top.details === "object" ? top.details as Record<string, unknown> : top;
  const status = detail.status === "matched" || detail.status === "no_match" ? `status=${detail.status}` : "";
  const flags = ["saved", "cancelled", "confirmationRequired", "clarificationRequired", "undone", "notFound"]
    .filter((key) => typeof detail[key] === "boolean")
    .map((key) => `${key}=${String(detail[key])}`);
  return [status, ...flags].filter(Boolean).join(",") || "completed";
}
