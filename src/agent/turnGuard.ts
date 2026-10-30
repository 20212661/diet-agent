/**
 * 单轮 Agent 会话的限制与看门狗。
 *
 * runAgentSessionTurn 依赖 SDK 事件流判断一轮是否结束；当 provider 连接挂住、
 * 不报错也不结束时，这一轮永远不会返回，并卡死按 userId 串行的请求队列。
 * TurnGuard 用四道独立限制兜底：
 * - deadline：单轮总截止时间；
 * - idle：空闲看门狗，连续这么久没有任何会话事件即判卡死（工具执行期间暂停计时）；
 * - tool_budget / llm_budget：单轮工具与模型调用次数上限，防模型陷入循环。
 */

export type TurnLimitReason = "deadline" | "idle" | "tool_budget" | "llm_budget";

export class TurnLimitError extends Error {
  constructor(
    readonly reason: TurnLimitReason,
    readonly elapsedMs: number,
  ) {
    super(`Agent turn stopped: ${reason} after ${elapsedMs}ms`);
    this.name = "TurnLimitError";
  }
}

export interface TurnLimits {
  /** 单轮总截止时间。 */
  deadlineMs: number;
  /** 空闲看门狗时长；SDK 自动重试的退避等待会在其基础上延长。 */
  idleMs: number;
  maxToolCalls: number;
  maxLlmCalls: number;
  /** 触发限制后等待 session.abort() 完成的最长时间，超过即放弃等待并结束本轮。 */
  abortGraceMs: number;
}

function positiveEnvNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadTurnLimits(env: NodeJS.ProcessEnv = process.env): TurnLimits {
  return {
    deadlineMs: positiveEnvNumber(env, "AGENT_TURN_TIMEOUT_MS", 120_000),
    idleMs: positiveEnvNumber(env, "AGENT_IDLE_TIMEOUT_MS", 45_000),
    maxToolCalls: Math.floor(positiveEnvNumber(env, "AGENT_MAX_TOOL_CALLS", 12)),
    maxLlmCalls: Math.floor(positiveEnvNumber(env, "AGENT_MAX_LLM_CALLS", 10)),
    abortGraceMs: 5_000,
  };
}

/** 整个用户请求（含 fallback 各次尝试）的截止时间，避免多次降级叠加等待。 */
export function loadRequestDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveEnvNumber(env, "AGENT_REQUEST_TIMEOUT_MS", 180_000);
}

export interface TurnGuard {
  /** 任意会话事件到达时调用，重置空闲看门狗。 */
  touch(): void;
  /** assistant 消息开始生成（即一次模型请求开始）时调用。 */
  onLlmStart(): void;
  onToolStart(): void;
  onToolEnd(): void;
  /** SDK 自动重试开始退避等待时调用，按 delayMs 延长空闲看门狗。 */
  onRetryBackoff(delayMs: number): void;
  readonly tripped: TurnLimitError | undefined;
  dispose(): void;
}

export function createTurnGuard(
  limits: TurnLimits,
  onTrip: (error: TurnLimitError) => void,
): TurnGuard {
  const start = Date.now();
  let tripped: TurnLimitError | undefined;
  let toolCalls = 0;
  let llmCalls = 0;
  let runningTools = 0;
  let idleTimer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;

  const dispose = () => {
    clearTimeout(deadlineTimer);
    clearTimeout(idleTimer);
    deadlineTimer = undefined;
    idleTimer = undefined;
  };

  const trip = (reason: TurnLimitReason) => {
    if (tripped) return;
    tripped = new TurnLimitError(reason, Date.now() - start);
    dispose();
    onTrip(tripped);
  };

  // 工具执行期间 Agent 本来就不产生事件（如首次加载本地 embedding 模型），
  // 这段时间不参与空闲判定，交给单工具超时兜底。
  const armIdle = (ms: number) => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    if (tripped || runningTools > 0) return;
    idleTimer = setTimeout(() => trip("idle"), ms);
  };

  deadlineTimer = setTimeout(() => trip("deadline"), limits.deadlineMs);
  armIdle(limits.idleMs);

  return {
    touch: () => armIdle(limits.idleMs),
    onLlmStart() {
      if (tripped) return;
      llmCalls += 1;
      if (llmCalls > limits.maxLlmCalls) trip("llm_budget");
    },
    onToolStart() {
      if (tripped) return;
      runningTools += 1;
      clearTimeout(idleTimer);
      idleTimer = undefined;
      toolCalls += 1;
      if (toolCalls > limits.maxToolCalls) trip("tool_budget");
    },
    onToolEnd() {
      runningTools = Math.max(0, runningTools - 1);
      if (!tripped && runningTools === 0) armIdle(limits.idleMs);
    },
    onRetryBackoff: (delayMs: number) => {
      armIdle(limits.idleMs + Math.max(0, delayMs));
    },
    get tripped() {
      return tripped;
    },
    dispose,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
