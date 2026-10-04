interface ActiveUserTurn { message: string; operationId?: string; operationCounts: Map<string, number>; }
const activeTurns = new Map<string, ActiveUserTurn>();

export function setActiveUserMessage(userId: string, message: string, operationId?: string): () => void {
  const previous = activeTurns.get(userId);
  activeTurns.set(userId, { message, ...(operationId ? { operationId } : {}), operationCounts: new Map() });
  return () => {
    if (previous === undefined) activeTurns.delete(userId);
    else activeTurns.set(userId, previous);
  };
}

export function getActiveUserMessage(userId: string): string | undefined {
  return activeTurns.get(userId)?.message;
}

export function getActiveOperationId(userId: string, toolName: string): string | undefined {
  const turn = activeTurns.get(userId);
  if (!turn?.operationId) return undefined;
  const count = (turn.operationCounts.get(toolName) ?? 0) + 1;
  turn.operationCounts.set(toolName, count);
  return `${turn.operationId}:${toolName}:${count}`;
}

export function isTemporaryAvoidanceMessage(message: string | undefined): boolean {
  if (!message) return false;
  if (/(?:我对|过敏|长期|以后|永远|从今(?:天)?起)/.test(message)) return false;
  const hasShortTerm = /(?:这周|本周|今晚|今天|明天|这两天|暂时|先不吃|先别|这顿|这一餐|近期|最近几天)/.test(message);
  const hasAvoidance = /(?:不吃|避免|别安排|不要|先别|忌口)/.test(message);
  return hasShortTerm && hasAvoidance;
}

export function hasAmbiguousMealDate(message: string | undefined): boolean {
  if (!message) return false;
  if (/(?:昨天|前天|大前天|明天|后天|上周|上个月|几天前|周末|周[一二三四五六日天])/.test(message)) return true;
  return !/(?:今天|今晚|今早|今天早|今天中午|今天晚|刚才|刚刚|刚吃|早饭|早餐|中午|午饭|午餐|晚饭|晚餐|加餐)/.test(message);
}
