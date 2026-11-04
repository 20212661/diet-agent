/**
 * 语义提取的每用户串行队列（用户口径第 3 点）。
 *
 * - 每个用户的提取任务严格串行（链式 Promise），不同用户互不影响；
 * - 下一轮开始前 waitForPendingExtraction 最多等 2 秒：等到 → 用新状态，
 *   超时 → 用旧状态，由调用方在 trace 上记 fallback span；
 * - 队列任务自身全捕获：提取失败绝不影响聊天主流程（不更新优于错更新）。
 */

const DEFAULT_WAIT_MS = 2_000;

const tails = new Map<string, Promise<void>>();

/** 排入一个提取任务（返回队尾，测试可 await）；任务异常在链内消化。 */
export function enqueueExtraction(userId: string, job: () => Promise<unknown>): Promise<void> {
  const previous = tails.get(userId) ?? Promise.resolve();
  const tail: Promise<void> = previous
    .then(() => job().then(() => undefined))
    .catch(() => undefined)
    .finally(() => {
      if (tails.get(userId) === tail) tails.delete(userId);
    });
  tails.set(userId, tail);
  return tail;
}

/** 下一轮前等待该用户的提取排空；true=已排空（用新状态），false=超时（用旧状态）。 */
export async function waitForPendingExtraction(userId: string, timeoutMs: number = DEFAULT_WAIT_MS): Promise<boolean> {
  const tail = tails.get(userId);
  if (!tail) return true;
  let timedOut = false;
  const timer = new Promise<void>((resolve) => setTimeout(() => {
    timedOut = true;
    resolve();
  }, timeoutMs));
  await Promise.race([tail.catch(() => undefined), timer]);
  return !timedOut;
}

/** 测试用：清空队列状态。 */
export function _resetExtractionQueueForTests(): void {
  tails.clear();
}

/** 测试用：当前是否有排队中的任务。 */
export function hasPendingExtraction(userId: string): boolean {
  return tails.has(userId);
}
