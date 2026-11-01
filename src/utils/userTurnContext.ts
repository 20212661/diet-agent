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
  // 早上/晚上/夜宵等时段词默认指今天（无相对日期词时先到达此行），避免"早上喝了一杯拿铁"被反复追问日期。
  return !/(?:今天|今晚|今早|今天早|今天中午|今天晚|刚才|刚刚|刚吃|早饭|早餐|早上|早晨|中午|午饭|午餐|晚饭|晚餐|晚上|夜宵|宵夜|加餐)/.test(message);
}

/** 回复末尾追加的未落库提示（bench 以此标记统计 claimed_unsaved）。 */
export const MEAL_CLAIM_UNSAVED_NOTICE =
  "⚠️ 注意：这条饮食记录还没有保存到数据库（本轮没有成功的记录写入）。如需保存，请让我现在记录。";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/**
 * 每轮注入用户消息前的当前时间上下文（模型没有可靠的"今天"概念，
 * "昨天/明天"类相对日期全靠猜）。用与 store 的 todayDate() 相同的
 * 本地时间 getters，保证模型说的"今天"和数据库写入的"今天"一致；
 * 不进 system prompt——那会让前缀缓存每天零点失效一次。
 */
export function currentDateTimeContext(now = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "本地时区";
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `〔当前时间：${year}-${month}-${day} ${WEEKDAY_LABELS[now.getDay()]} ${hour}:${minute}（${timezone}）〕`;
}

/**
 * 兜底校验用：回复是否声称"已记录/记下了"，但可能实际没有落库。
 * 按句检测：句子含完成态声称词且不含否定词（没/未/别/不）。
 * "记成"必须后跟数量或餐次（记成 1 杯），避免撞上"登记成现有食材"；
 * 不收"记进"（会撞"记进库存"），此类漏报由词表演进兜底。
 * 误报的代价只是多一句提示，且提示内容（尚未保存）在无成功写入时恒为事实。
 */
export function detectUnsavedMealClaim(reply: string): boolean {
  const claimWords = /(已记录|已经记录|已帮你记录|帮你记下了|记录了|记下了|记上了|记成了?(?=\s*[0-9一二两三四五六七八九十半杯碗盘份个根]))/;
  const sentences = reply.split(/[。！？!?\n]/);
  return sentences.some((sentence) => claimWords.test(sentence) && !/[没未别不]/.test(sentence));
}
