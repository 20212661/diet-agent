/**
 * 工具参数修复的观测与统计：仅评测模式启用，纯内存，不落库。
 *
 * 配合 A 组评测回答"参数修复中间件值不值"：
 * - classifyArgumentRepairs 比较修复前后的参数，按问题类型打标：
 *   array_as_string（数组被传成字符串）、boolean_as_text（布尔被传成中文）、
 *   number_as_string（数字被传成字符串）、json_string_args（参数整体是
 *   字符串或 {input} 包装结构，靠 JSON 解析救回）。
 * - missing_field 由 wrapToolsForUser 按 typebox schema.required 检测，
 *   排除 userId/operationId——那是中间件强制注入的安全/幂等字段，
 *   计入会淹没真实信号。
 */

export type RepairCategory = "array_as_string" | "boolean_as_text" | "number_as_string" | "json_string_args";
export type ToolIssueCategory = RepairCategory | "missing_field";

export interface ToolRepairTelemetrySummary {
  /** 观测到的工具调用数（prepareArguments 次数）。 */
  toolCalls: number;
  callsWithIssues: number;
  /** 存在任一格式问题的调用占比（0-1，保留 3 位）。 */
  issueRate: number;
  byCategory: Partial<Record<ToolIssueCategory, number>>;
  affectedTools: Record<string, number>;
}

interface RecordingState {
  toolCalls: number;
  callsWithIssues: number;
  byCategory: Record<string, number>;
  affectedTools: Record<string, number>;
}

let active: RecordingState | undefined;

export function startToolRepairRecording(): void {
  active = { toolCalls: 0, callsWithIssues: 0, byCategory: {}, affectedTools: {} };
}

export function toolRepairRecordingActive(): boolean {
  return active !== undefined;
}

export function stopToolRepairRecording(): ToolRepairTelemetrySummary | undefined {
  if (!active) return undefined;
  const snapshot = active;
  active = undefined;
  return {
    toolCalls: snapshot.toolCalls,
    callsWithIssues: snapshot.callsWithIssues,
    issueRate: snapshot.toolCalls > 0 ? Math.round((snapshot.callsWithIssues / snapshot.toolCalls) * 1000) / 1000 : 0,
    byCategory: snapshot.byCategory,
    affectedTools: snapshot.affectedTools,
  };
}

/** 仅测试用：丢弃当前记录。 */
export function discardToolRepairRecording(): void {
  active = undefined;
}

export function recordToolArgumentIssues(toolName: string, categories: readonly ToolIssueCategory[]): void {
  if (!active) return;
  active.toolCalls += 1;
  if (categories.length === 0) return;
  active.callsWithIssues += 1;
  active.affectedTools[toolName] = (active.affectedTools[toolName] ?? 0) + 1;
  for (const category of new Set(categories)) {
    active.byCategory[category] = (active.byCategory[category] ?? 0) + 1;
  }
}

/** 对比类型修复前后的参数，归纳出现的问题类型（每类每次调用至多计一次）。 */
export function classifyArgumentRepairs(before: Record<string, unknown>, after: Record<string, unknown>): RepairCategory[] {
  const found = new Set<RepairCategory>();
  const visit = (b: unknown, a: unknown) => {
    if (typeof b === "string" && Array.isArray(a)) found.add("array_as_string");
    else if (typeof b === "string" && typeof a === "boolean") found.add("boolean_as_text");
    else if (typeof b === "string" && typeof a === "number") found.add("number_as_string");
    else if (isPlainObject(b) && isPlainObject(a)) {
      const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const key of keys) visit(b[key], a[key]);
    }
  };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[key], after[key]);
  return [...found];
}

/** 参数整体是字符串或 {input}/{arguments} 包装结构（需要 coerceObject 才能救回）。 */
export function isStructuralJsonArgs(args: unknown): boolean {
  if (typeof args === "string") return true;
  if (!isPlainObject(args)) return false;
  if (typeof args.arguments === "string") return true;
  return args.input !== undefined && isPlainObject(args.input) && Object.keys(args).length === 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
