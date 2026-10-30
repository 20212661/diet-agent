/**
 * 工具结果的状态归纳：只输出可安全写日志/trace 的状态码，不含参数值或敏感结果。
 * createDietAgent 的写入判定与 traceRecorder 的 span 状态共用这一份实现。
 */

/** 写入类工具：结果影响持久化数据，超时/中止时需要人工核对。 */
export const WRITE_TOOLS = new Set([
  "create_shopping_task",
  "log_meal", "edit_meal_log", "undo_meal_log", "update_user_profile", "update_kitchen_profile",
  "update_ingredient_inventory", "mark_ingredient_used", "generate_meal_plan", "generate_weekly_plan",
  "log_cooking_feedback", "generate_cooking_plan",
]);

/**
 * 写工具超时时 wrapToolsForUser 返回的结构化结果标记：
 * 底层调用可能仍在后台执行完，无法确认是否已保存，模型不得重试。
 */
export const UNCONFIRMED_TOOL_STATUS = "unconfirmed";

/** 判断写工具的 result 是否为“执行超时/无法确认”的结构化结果。 */
export function toolResultIndicatesUnconfirmed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return false;
  return (details as Record<string, unknown>).status === UNCONFIRMED_TOOL_STATUS;
}

/** 判断写工具的 result 是否表示数据确已保存（用于决定是否需要人工核对）。 */
export function toolResultIndicatesSuccess(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return true;
  const outcome = details as Record<string, unknown>;
  return outcome.saved !== false && outcome.undone !== false && outcome.clarificationRequired !== true && outcome.notFound !== true
    && outcome.status !== "no_match" && outcome.status !== UNCONFIRMED_TOOL_STATUS;
}

/** 把工具结果归纳为不含敏感内容的状态串，用于日志和 trace span。 */
export function safeToolOutcome(result: unknown, isError: boolean): string {
  if (isError) return "error";
  if (!result || typeof result !== "object") return "completed";
  const top = result as Record<string, unknown>;
  const detail = top.details && typeof top.details === "object" ? top.details as Record<string, unknown> : top;
  const knownStatus = ["matched", "no_match", UNCONFIRMED_TOOL_STATUS].includes(String(detail.status))
    ? `status=${String(detail.status)}`
    : "";
  const flags = ["saved", "cancelled", "confirmationRequired", "clarificationRequired", "undone", "notFound", "retryForbidden"]
    .filter((key) => typeof detail[key] === "boolean")
    .map((key) => `${key}=${String(detail[key])}`);
  return [knownStatus, ...flags].filter(Boolean).join(",") || "completed";
}
