"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_ROUTING_MESSAGE_LENGTH, type SessionRouteResult } from "@/lib/session-routing";
import type { SessionInfo } from "@/lib/types";

export interface RoutedTask { requestId: string; message: string; target: SessionInfo }

export function SessionRouter({ onRoute, onExit, canReturn, onReturn }: {
  onRoute: (task: RoutedTask) => void; onExit: () => void;
  canReturn: boolean; onReturn: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ result: Extract<SessionRouteResult, { kind: "choose" }>; original: string; requestId: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeRequest = useRef<string | null>(null);
  const forwarded = useRef(new Set<string>());
  useEffect(() => () => controller.current?.abort(), []);

  async function forward(target: SessionInfo, original: string, requestId: string, signal: AbortSignal) {
    if (activeRequest.current !== requestId || forwarded.current.has(requestId)) return;
    const response = await fetch(`/api/sessions/${encodeURIComponent(target.id)}?tail=1&tree=summary&deferThinking=1&deferMedia=1`, { signal });
    if (!response.ok) throw new Error(t("router.targetGone"));
    signal.throwIfAborted();
    if (activeRequest.current !== requestId || forwarded.current.has(requestId)) return;
    forwarded.current.add(requestId);
    onRoute({ requestId, message: original, target });
  }

  async function submit() {
    if (busy || !message.trim()) return;
    const original = message;
    const requestId = crypto.randomUUID();
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    activeRequest.current = requestId;
    setBusy(true); setError(null); setChoice(null);
    try {
      const response = await fetch("/api/session-router", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: original }), signal: next.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("router.failed"));
      if (next.signal.aborted || activeRequest.current !== requestId) return;
      if (result.kind === "open" && typeof result.target?.id === "string") {
        await forward(result.target, original, requestId, next.signal);
      } else if (result.kind === "choose" && Array.isArray(result.candidates) && typeof result.message === "string") {
        setChoice({ result, original, requestId });
      } else throw new Error(t("router.failed"));
    } catch (cause) {
      if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : t("router.failed"));
    } finally {
      if (activeRequest.current === requestId) setBusy(false);
    }
  }

  async function choose(target: SessionInfo) {
    if (!choice || busy || !controller.current) return;
    setBusy(true); setError(null);
    try { await forward(target, choice.original, choice.requestId, controller.current.signal); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("router.failed")); }
    finally { setBusy(false); }
  }

  async function returnToLastChat() {
    if (!canReturn || busy) return;
    controller.current?.abort();
    activeRequest.current = null;
    setBusy(true); setError(null);
    try { await onReturn(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("router.failed")); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label={t("router.title")}  style={{ height: "100%", overflowY: "auto", padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 680, margin: "auto 0" }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{t("router.title")}</h1>
        <p style={{ color: "var(--text-muted)", lineHeight: 1.7, fontSize: 14 }}>{t("router.description")}</p>
        <p style={{ color: "var(--text-dim)", fontSize: 12 }}>GPT-6 Luna · {t("router.readOnly")}</p>
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <textarea aria-label={t("router.task")} placeholder={t("router.placeholder")} value={message} maxLength={MAX_ROUTING_MESSAGE_LENGTH}
            disabled={busy} onChange={event => { setMessage(event.target.value); setChoice(null); }}
            rows={4} style={{ width: "100%", boxSizing: "border-box", minHeight: 120, resize: "vertical", padding: 14,
              border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", color: "var(--text)", font: "inherit", lineHeight: 1.6 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={busy || !message.trim()} style={{ ...buttonStyle, color: "var(--accent)" }}>{busy ? t("router.searching") : t("router.find")}</button>
            {busy && <button type="button" style={buttonStyle} onClick={() => { controller.current?.abort(); activeRequest.current = null; setBusy(false); }}>{t("common.cancel")}</button>}
            <button type="button" style={buttonStyle} disabled={!canReturn || busy} title={!canReturn ? t("router.noLastChat") : undefined}
              onClick={() => void returnToLastChat()}>{t("router.returnLastChat")}</button>
            <button type="button" style={buttonStyle} onClick={onExit}>{t("router.normalChat")}</button>
          </div>
        </form>
        {busy && <p role="status" style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("router.searchingHint")}</p>}
        {error && <p role="alert" style={{ color: "#dc2626", whiteSpace: "pre-wrap" }}>{error}</p>}
        {choice && <div style={{ marginTop: 20 }}>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{choice.result.message}</p>
          {choice.result.candidates.map(target => <button key={target.id} type="button" disabled={busy} onClick={() => void choose(target)}
            style={{ ...buttonStyle, width: "100%", textAlign: "left", display: "block", marginTop: 8 }}>
            <strong style={{ display: "block", overflowWrap: "anywhere" }}>{target.name || target.firstMessage.slice(0, 100) || target.id}</strong>
            <span style={{ fontSize: 12, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{target.cwd}</span>
          </button>)}
        </div>}
      </div>
    </section>
  );
}

const buttonStyle = { padding: "9px 14px", border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 13 };
