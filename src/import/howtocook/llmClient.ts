/**
 * 管道专用轻量 LLM 客户端：OpenAI 兼容 chat/completions + JSON 输出。
 *
 * 只给离线导入管道用（批量结构化任务），不进运行时路径；生产 Agent
 * 仍走 SDK 候选链。失败重试 2 次，JSON 解析失败按错误重试。
 */
import "dotenv/config";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.HTC_IMPORT_MODEL ?? "deepseek-flash";

export async function chatJson<T>(systemPrompt: string, userPrompt: string, retries = 2): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY（.env）");
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("响应缺少 content");
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw new Error(`LLM 调用失败（${retries + 1} 次尝试）：${String(lastError)}`);
}
