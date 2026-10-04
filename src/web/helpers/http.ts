import type { ServerResponse } from "node:http";
import { WebWriteConflictError } from "../writeOnce.js";
export { readJson } from "../payloadValidation.js";

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

export function sendWriteError(response: ServerResponse, error: unknown, fallback: string): void {
  sendJson(response, error instanceof WebWriteConflictError ? 409 : 400, {
    error: error instanceof Error ? error.message : fallback,
  });
}
