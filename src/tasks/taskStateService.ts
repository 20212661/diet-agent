/**
 * 任务状态生命周期服务（v1 只做 meal_plan 排菜计划工作流）。
 *
 * 生命周期（用户口径）：
 *  - 创建：调用 generate_meal_plan / generate_weekly_plan（或识别到排菜意图，PR B 语义层）
 *    且无 active 任务时创建；已有 active 则复用（重复排菜=同一任务内调整）。
 *  - 结束：计划保存后用户确认或转换话题（PR B 语义层）；超过 6 小时不活跃在读时惰性结束。
 *  - 注入：只注入 active 且最近活跃的任务；任务结束后不再注入。
 *
 * 被否决的菜（rejected）：只存菜谱 ID，排菜工具读出后传给匹配算法在代码层过滤——
 * 不依赖提示词自觉。过敏与忌口不进任务状态（安全过滤永远读用户画像）。
 */
import { randomUUID } from "node:crypto";
import type { TaskRejectedItem, TaskState } from "./taskStateTypes.js";
import { TASK_INACTIVE_TIMEOUT_MS } from "./taskStateTypes.js";
import {
  insertTaskState,
  listActiveTaskStates,
  updateTaskState,
} from "../store/repositories/taskStateRepository.js";
import { getRecipeBookForUser } from "../store/repositories/userRecipeRepository.js";
import { normalizeRecipeName } from "../import/howtocook/dedupe.js";

/** 6h 不活跃的 active 任务惰性结束（abandoned）；now 可注入便于测试。 */
export function endStaleTasks(userId: string, now: number = Date.now()): number {
  let ended = 0;
  for (const task of listActiveTaskStates(userId)) {
    const updated = Date.parse(task.updatedAt);
    if (Number.isFinite(updated) && now - updated > TASK_INACTIVE_TIMEOUT_MS) {
      updateTaskState(userId, task.taskId, { status: "abandoned" });
      ended += 1;
    }
  }
  return ended;
}

/** 是否存在 active 任务（轮后提取的轻量门槛：无任务不排队提取）。 */
export function hasActiveTask(userId: string): boolean {
  return getInjectableTask(userId) !== undefined;
}

/** 注入用任务：先惰性结束超时任务，再取最近活跃的 active（单注入源）。 */
export function getInjectableTask(userId: string, now: number = Date.now()): TaskState | undefined {
  endStaleTasks(userId, now);
  return listActiveTaskStates(userId)[0];
}

/** 无 active 任务时创建（工具触发与语义意图共用）；有则返回现有。 */
export function ensureMealPlanTask(userId: string): TaskState {
  const active = getInjectableTask(userId);
  if (active) return active;
  return insertTaskState({
    userId,
    taskId: `task_${randomUUID().slice(0, 8)}`,
    workflow: "meal_plan",
    status: "active",
    goal: "",
    stage: "plan_requested",
    constraints: {},
    decisions: [],
    rejected: [],
    artifactIds: {},
    openQuestions: [],
  });
}

/** 排菜工具触发：无 active 则创建，有则复用（含阶段与确定性约束/产物写入）。 */
export function noteMealPlanToolCall(
  userId: string,
  toolName: "generate_meal_plan" | "generate_weekly_plan",
  outcome: { ok: boolean; mealPlanStartDate?: string; weeklyPlanWeekStartDate?: string; timeLimitMinutes?: number; energyLevel?: "low" | "normal"; styles?: string[] }
): TaskState {
  const task = ensureMealPlanTask(userId);
  // 约束在调用即记录（即使 no_match，本轮的时间/精力/风格要求仍是任务事实）
  if (outcome.timeLimitMinutes !== undefined || outcome.energyLevel !== undefined || outcome.styles !== undefined) {
    const withConstraints = updateTaskState(userId, task.taskId, {
      constraints: {
        ...task.constraints,
        ...(outcome.timeLimitMinutes !== undefined ? { timeLimitMinutes: outcome.timeLimitMinutes } : {}),
        ...(outcome.energyLevel !== undefined ? { energyLevel: outcome.energyLevel } : {}),
        ...(outcome.styles !== undefined ? { styles: outcome.styles } : {}),
      },
    });
    if (!outcome.ok) return withConstraints ?? task;
  } else if (!outcome.ok) {
    return task;
  }

  const artifactPatch = task.artifactIds;
  if (outcome.mealPlanStartDate) artifactPatch.mealPlanId = outcome.mealPlanStartDate;
  if (outcome.weeklyPlanWeekStartDate) artifactPatch.weeklyPlanWeekStartDate = outcome.weeklyPlanWeekStartDate;
  return updateTaskState(userId, task.taskId, {
    // 两个排菜工具成功即落库（meal_plans / weekly_plans），因此成功=plan_saved
    stage: "plan_saved",
    constraints: {
      ...task.constraints,
      ...(outcome.timeLimitMinutes !== undefined ? { timeLimitMinutes: outcome.timeLimitMinutes } : {}),
      ...(outcome.energyLevel !== undefined ? { energyLevel: outcome.energyLevel } : {}),
      ...(outcome.styles !== undefined ? { styles: outcome.styles } : {}),
    },
    artifactIds: artifactPatch,
  }) ?? task;
}

/** 被否决的菜：菜名解析为库内菜谱 ID 后追加（解析不到的丢弃——过滤只能按 ID 生效）。 */
export function rejectRecipes(userId: string, names: readonly string[], now: number = Date.now()): TaskRejectedItem[] {
  const task = getInjectableTask(userId);
  if (!task || names.length === 0) return task?.rejected ?? [];
  const book = getRecipeBookForUser(userId);
  const existing = new Set(task.rejected.map((item) => item.recipeId));
  const appended: TaskRejectedItem[] = [];
  const at = new Date(now).toISOString();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = book.find(
      (recipe) => recipe.name === name || normalizeRecipeName(recipe.name) === normalizeRecipeName(name)
    );
    if (!hit || existing.has(hit.id)) continue;
    existing.add(hit.id);
    appended.push({ recipeId: hit.id, name: hit.name, at });
    if (task.rejected.length + appended.length >= 20) break;
  }
  if (appended.length > 0) {
    updateTaskState(userId, task.taskId, { rejected: [...task.rejected, ...appended] });
  }
  return [...task.rejected, ...appended];
}

/** 排菜路径的硬过滤 ID 集：active 任务存在时才有过滤（任务结束即失效）。 */
export function rejectedRecipeIdsForUser(userId: string): string[] {
  const task = getInjectableTask(userId);
  return task ? task.rejected.map((item) => item.recipeId) : [];
}

export function endTask(userId: string, taskId: string, status: "completed" | "abandoned"): void {
  updateTaskState(userId, taskId, { status });
}
