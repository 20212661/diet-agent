/**
 * 错误处理工具
 */

/** 格式化错误为用户可读的 JSON 响应 */
export function formatErrorResponse(error: unknown): {
  ok: false;
  error: string;
} {
  if (error instanceof Error) {
    // 不暴露内部堆栈，只返回消息
    const message = error.message ?? "未知错误";
    return {
      ok: false,
      error: message.length > 500 ? message.slice(0, 500) + "..." : message,
    };
  }
  return { ok: false, error: "未知内部错误" };
}

/** 创建一个业务错误 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}
