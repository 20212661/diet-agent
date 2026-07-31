/**
 * Reciprocal Rank Fusion（倒数排名融合）。
 *
 * 只看每个通道的「排名」，不看分数——正好规避向量 L2 距离与 BM25 分数
 * 不在一个量纲、无法直接比较的归一化难题。
 *
 * 公式：score(d) = Σ_channel 1 / (k + rank_channel(d))，rank 从 1 开始。
 * k 默认 60（业界经验值，原始论文推荐）。
 */
export interface RrfResult {
  id: string;
  score: number;
}

export function reciprocalRankFusion(rankedLists: string[][], k = 60): RrfResult[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      // rank 从 0，排名从 1 → 1 / (k + rank + 1)
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
