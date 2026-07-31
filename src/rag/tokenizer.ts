/**
 * bigram 双字分词。
 *
 * 解决 FTS5 默认 tokenizer 对无空格 CJK 不分词的问题（实测 unicode61 把
 * "番茄炒蛋" 当成单个 token，查"番茄"查不到）。写入和查询前都先用本函数预处理，
 * 把连续字符切成相邻双字、空格连接，unicode61 再按空格分词即可正常工作。
 */
export function bigramize(text: string): string {
  if (!text) return "";
  // 按空白 / 标点 / 符号分段，保留中英文与数字连续段
  const segments = text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  const tokens: string[] = [];
  for (const seg of segments) {
    if (seg.length < 2) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.slice(i, i + 2));
      }
    }
  }
  return tokens.join(" ");
}
