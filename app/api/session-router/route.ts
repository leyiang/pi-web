import { NextResponse } from "next/server";
import { hasJsonContentType } from "@/lib/request-security";
import { routeSessionTask } from "@/lib/session-router";
import { MAX_ROUTING_MESSAGE_LENGTH } from "@/lib/session-routing";

export const dynamic = "force-dynamic";
const key = Symbol.for("pi-web:session-router-active");
const globalState = globalThis as typeof globalThis & { [key]?: number };

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415, headers });
  let message: string;
  try {
    const body = await request.json();
    if (typeof body?.message !== "string" || !body.message.trim() || body.message.length > MAX_ROUTING_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `任务描述需要 1–${MAX_ROUTING_MESSAGE_LENGTH} 个字符。` }, { status: 400, headers });
    }
    message = body.message;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }
  if ((globalState[key] ?? 0) >= 2) return NextResponse.json({ error: "路由助手正在处理其他请求，请稍后重试。" }, { status: 429, headers });
  globalState[key] = (globalState[key] ?? 0) + 1;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
  try {
    const result = await routeSessionTask(message, { signal });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const unavailable = error instanceof Error && error.message === "ROUTER_MODEL_UNAVAILABLE";
    return NextResponse.json({ error: signal.aborted ? "路由已取消或超时，请重试。"
      : unavailable ? "当前实例找不到 OpenAI Codex 的 GPT-6 Luna，请检查模型配置和登录状态。"
      : "路由失败，请检查 Luna 的登录状态或稍后重试。普通聊天未受影响。" },
    { status: signal.aborted ? 504 : unavailable ? 503 : 502, headers });
  } finally {
    globalState[key] = Math.max(0, (globalState[key] ?? 1) - 1);
  }
}
