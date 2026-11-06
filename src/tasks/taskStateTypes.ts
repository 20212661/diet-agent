/**
 * 长对话结构化任务状态：类型定义（v1 只做"排菜计划" meal_plan 工作流）。
 *
 * 确定性字段（工具执行后由代码写入）：stage 推进、constraints（非过敏类任务约束）、
 * artifactIds（只存 ID 不存全文）、rejected（菜谱 ID，匹配算法硬过滤）。
 * 语义字段（LLM 提取，PR B）：goal、decisions、openQuestions。
 *
 * 安全边界：**过敏与忌口只存用户画像，绝不进任务状态**——任务状态可被对话内容
 * 污染（提示注入），画像才是安全过滤的唯一事实源。字段一律限长（注入层再截断）。
 */

export type TaskWorkflow = "meal_plan";
export type TaskStatus = "active" | "completed" | "abandoned";

/** 已做决策（语义提取；限 10 条、每条 ≤120 字）。 */
export interface TaskDecision {
  content: string;
  at: string;
  source: "user" | "tool";
}

/** 被否决的菜：**只存菜谱 ID**，排菜时传给匹配算法在代码层过滤（不只靠提示词）。 */
export interface TaskRejectedItem {
  recipeId: string;
  name: string;
  at: string;
}

/**
 * 本轮任务约束（非过敏类）：时间/精力/风格偏好。
 * 过敏与忌口不在此处——安全过滤永远从用户画像读取。
 */
export interface TaskConstraints {
  timeLimitMinutes?: number;
  energyLevel?: "low" | "normal";
  styles?: string[];
  notes?: string[];
}

/** 相关产物引用：只存 ID，不存全文。 */
export interface TaskArtifactIds {
  mealPlanId?: string;
  weeklyPlanWeekStartDate?: string;
  recipeIds?: string[];
  mealLogIds?: string[];
  /** 上一轮工具结果推荐过的菜（否决捕获的规则层输入；满 30 截尾）。 */
  suggestedRecipeIds?: string[];
}

export interface TaskState {
  userId: string;
  taskId: string;
  workflow: TaskWorkflow;
  status: TaskStatus;
  goal: string;
  stage: string;
  constraints: TaskConstraints;
  /**
   * 本轮排菜的用餐成员 ID（"self" + 物理 memberId；undefined=未指定=全部成员）。
   * 确定性字段：由排菜工具参数经 noteMealPlanToolCall 代码写入，语义提取器不可改。
   * 只存 ID 不存过敏内容——成员过敏并集在过滤时从画像/成员数据实时合成。
   */
  diningMembers?: string[];
  decisions: TaskDecision[];
  rejected: TaskRejectedItem[];
  artifactIds: TaskArtifactIds;
  openQuestions: string[];
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
}

/** 语义提取的增量 patch（白名单字段，PR B 的提取器输出过这里清洗）。 */
export interface TaskStatePatch {
  goal?: string;
  stage?: string;
  decisionsAppend?: TaskDecision[];
  rejectedAppend?: TaskRejectedItem[];
  openQuestions?: string[];
  endTask?: "completed" | "abandoned";
}

/** 阶段机（排菜计划）：确定性推进 + 语义修正共用这一套枚举。 */
export const MEAL_PLAN_STAGES = [
  "plan_requested", // 调用排菜工具/识别到排菜意图
  "candidates_presented", // 候选已给出（工具成功返回）
  "plan_saved", // 计划已保存（save 工具成功）
  "adjusting", // 保存后仍在调整
] as const;
export type MealPlanStage = (typeof MEAL_PLAN_STAGES)[number];

/** 字段限长（防持久化注入的一部分：见 buildTaskStateInjection）。 */
export const TASK_LIMITS = {
  goalMaxLength: 200,
  decisionMaxItems: 10,
  decisionContentMaxLength: 120,
  rejectedMaxItems: 20,
  openQuestionMaxItems: 5,
  openQuestionMaxLength: 120,
} as const;

/** 不活跃自动结束：超过 6 小时未更新的 active 任务在读时惰性结束。 */
export const TASK_INACTIVE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
