import type { SessionInfo } from "./types";

export const ROUTER_PROVIDER = "openai-codex";
export const ROUTER_MODEL = "gpt-6-luna";
export const MAX_ROUTING_MESSAGE_LENGTH = 8000;

export type SessionRouteResult =
  | { kind: "open"; target: SessionInfo; reason: string }
  | { kind: "choose"; candidates: SessionInfo[]; message: string };

/** Explicit links/new-composer URLs retain their existing navigation behavior. */
export function startsOnSessionRouter(params: Pick<URLSearchParams, "get">): boolean {
  return !params.get("session") && !params.get("cwd");
}
