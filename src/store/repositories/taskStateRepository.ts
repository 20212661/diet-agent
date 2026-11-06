/**
 * 任务状态持久化（task_states 表，v24）。按 userId+taskId 存取；
 * 生命周期规则（单 active、6h 惰性超时）在 taskStateService 层。
 */
import type {
  TaskArtifactIds,
  TaskConstraints,
  TaskDecision,
  TaskRejectedItem,
  TaskState,
  TaskStatus,
  TaskWorkflow,
} from "../../tasks/taskStateTypes.js";
import { getDatabase } from "../database.js";
import { nowISO, parseJsonField } from "../shared.js";

interface TaskStateRow {
  user_id: string;
  task_id: string;
  workflow: string;
  status: string;
  goal: string;
  stage: string;
  constraints_json: string;
  decisions_json: string;
  rejected_json: string;
  artifact_ids_json: string;
  dining_members_json: string | null;
  open_questions_json: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

function rowToState(row: TaskStateRow): TaskState {
  return {
    userId: row.user_id,
    taskId: row.task_id,
    workflow: row.workflow as TaskWorkflow,
    status: row.status as TaskStatus,
    goal: row.goal,
    stage: row.stage,
    constraints: parseJsonField<TaskConstraints>(row.constraints_json, {}),
    decisions: parseJsonField<TaskDecision[]>(row.decisions_json, []),
    rejected: parseJsonField<TaskRejectedItem[]>(row.rejected_json, []),
    artifactIds: parseJsonField<TaskArtifactIds>(row.artifact_ids_json, {}),
    ...(row.dining_members_json ? { diningMembers: parseJsonField<string[]>(row.dining_members_json, []) } : {}),
    openQuestions: parseJsonField<string[]>(row.open_questions_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
  };
}

export function insertTaskState(state: Omit<TaskState, "createdAt" | "updatedAt" | "endedAt">): TaskState {
  const db = getDatabase();
  const now = nowISO();
  db.prepare(`
    INSERT INTO task_states (
      user_id, task_id, workflow, status, goal, stage,
      constraints_json, decisions_json, rejected_json, artifact_ids_json, dining_members_json, open_questions_json,
      created_at, updated_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id, task_id) DO NOTHING
  `).run(
    state.userId, state.taskId, state.workflow, state.status, state.goal, state.stage,
    JSON.stringify(state.constraints), JSON.stringify(state.decisions), JSON.stringify(state.rejected),
    JSON.stringify(state.artifactIds), state.diningMembers ? JSON.stringify(state.diningMembers) : null,
    JSON.stringify(state.openQuestions), now, now
  );
  return getTaskState(state.userId, state.taskId)!;
}

/** 按 patch 局部更新；updated_at 每次触碰都刷新（6h 不活跃判定依据）。 */
export function updateTaskState(
  userId: string,
  taskId: string,
  patch: Partial<Pick<TaskState, "status" | "goal" | "stage" | "constraints" | "diningMembers" | "decisions" | "rejected" | "artifactIds" | "openQuestions">>
): TaskState | undefined {
  const db = getDatabase();
  const existing = getTaskState(userId, taskId);
  if (!existing) return undefined;
  db.prepare(`
    UPDATE task_states SET
      status = ?, goal = ?, stage = ?,
      constraints_json = ?, decisions_json = ?, rejected_json = ?,
      artifact_ids_json = ?, dining_members_json = ?, open_questions_json = ?, updated_at = ?, ended_at = ?
    WHERE user_id = ? AND task_id = ?
  `).run(
    patch.status ?? existing.status,
    patch.goal ?? existing.goal,
    patch.stage ?? existing.stage,
    JSON.stringify(patch.constraints ?? existing.constraints),
    JSON.stringify(patch.decisions ?? existing.decisions),
    JSON.stringify(patch.rejected ?? existing.rejected),
    JSON.stringify(patch.artifactIds ?? existing.artifactIds),
    (patch.diningMembers !== undefined ? patch.diningMembers : existing.diningMembers) === undefined
      ? null
      : JSON.stringify((patch.diningMembers !== undefined ? patch.diningMembers : existing.diningMembers)),
    JSON.stringify(patch.openQuestions ?? existing.openQuestions),
    nowISO(),
    patch.status && patch.status !== "active" ? nowISO() : existing.endedAt ?? null,
    userId, taskId
  );
  return getTaskState(userId, taskId);
}

export function getTaskState(userId: string, taskId: string): TaskState | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM task_states WHERE user_id = ? AND task_id = ?")
    .get(userId, taskId) as TaskStateRow | undefined;
  return row ? rowToState(row) : undefined;
}

/** 该用户全部 active 任务按 updated_at 降序（服务层取第一个并保证单 active）。 */
export function listActiveTaskStates(userId: string): TaskState[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM task_states WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC")
    .all(userId) as TaskStateRow[];
  return rows.map(rowToState);
}

export function listTaskStates(userId: string): TaskState[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM task_states WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as TaskStateRow[];
  return rows.map(rowToState);
}
