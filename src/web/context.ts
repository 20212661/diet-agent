import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelCheckResult } from "../agent/configDoctor.js";

export interface WebContext {
  userId: string;
  port: number;
  urlHost: string;
  publicDir: string;
  getDashboardData: () => Record<string, unknown>;
  getLatestModelCheck: () => ModelCheckResult | null;
  setLatestModelCheck: (result: ModelCheckResult | null) => void;
  executeWebWriteOnce: <T>(route: string, payload: Record<string, unknown>, action: () => T) => T;
  streamChatOperation: (
    operationId: string,
    message: string,
    retryFailedRequest: boolean,
    emit: (event: unknown) => void,
  ) => Promise<void>;
}

export interface RouteContext extends WebContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}

export type RouteHandler = (ctx: RouteContext) => Promise<boolean> | boolean;
