"use client";

import { useEffect, useState } from "react";
import { acceptRealtimeEvent, getRealtimeDedupeKey, isActiveConversation, parseRealtimeEvent, shouldShowIncomingToast } from "@/lib/realtime/client-state";

type Toast = { id: string; type: "info" | "success" | "warning" | "error" | "message"; title: string; body?: string; href?: string };
type ToastRequest = { title: string; body?: string; type?: Toast["type"] };

const seenKey = "riezz99:realtime-seen";
function loadSeen() { try { return new Set(JSON.parse(sessionStorage.getItem(seenKey) ?? "[]") as string[]); } catch { return new Set<string>(); } }
function remember(value: string, seen: Set<string>) { seen.add(value); while (seen.size > 200) seen.delete(seen.values().next().value as string); try { sessionStorage.setItem(seenKey, JSON.stringify([...seen])); } catch { /* Storage can be disabled or full; realtime must continue. */ } }
function diagnosticsEnabled() { return process.env.NODE_ENV === "development" || process.env.REALTIME_DIAGNOSTICS === "1" || process.env.NEXT_PUBLIC_REALTIME_DIAGNOSTICS === "1"; }

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] flex flex-col items-stretch gap-2 sm:left-auto sm:right-5 sm:w-[min(26rem,calc(100vw-2rem))]">{toasts.map((toast) => <div key={toast.id} className="pointer-events-auto animate-[realtime-toast-in_.2s_ease-out] rounded-2xl border border-ink/10 bg-white p-4 shadow-2xl" role="status"><div className="flex items-start gap-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { if (toast.href) window.location.assign(toast.href); dismiss(toast.id); }}><p className="text-sm font-bold">{toast.title}</p>{toast.body && <p className="mt-1 text-sm leading-5 text-ink/65">{toast.body}</p>}</button><button type="button" aria-label="Tutup notifikasi" onClick={() => dismiss(toast.id)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-sand">×</button></div></div>)}</div>;
}

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const seen = loadSeen();
    let syncTimer: number | undefined;
    const dispatchSync = (reason: string) => {
      if (syncTimer !== undefined) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined;
        window.dispatchEvent(new CustomEvent("riezz99:realtime-sync", { detail: { reason } }));
      }, 100);
    };
    const dispatchStatus = (status: "connecting" | "connected" | "reconnecting") => {
      window.dispatchEvent(new CustomEvent("riezz99:realtime-status", { detail: { status } }));
    };
    const onToast = (event: Event) => {
      const request = (event as CustomEvent<ToastRequest>).detail;
      if (!request?.title) return;
      const id = `toast:${crypto.randomUUID()}`;
      setToasts((current) => [...current.slice(-2), { id, type: request.type ?? "info", title: request.title, body: request.body }]);
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
    };
    const source = new EventSource("/api/realtime/stream");
    const onReady = () => { dispatchStatus("connected"); dispatchSync("ready"); };
    const onError = () => dispatchStatus("reconnecting");
    const onVisibility = () => dispatchSync("visibility");
    const onFocus = () => dispatchSync("focus");
    const onOnline = () => dispatchSync("online");
    const onEvent = (event: MessageEvent<string>) => {
      const payload = parseRealtimeEvent(event.data);
      if (!payload) return;
      const dedupeKey = getRealtimeDedupeKey(payload);
      if (diagnosticsEnabled()) console.debug("[realtime-client] received", { type: payload.type, conversationId: payload.conversationId, hasHref: Boolean(payload.href) });
      if (!acceptRealtimeEvent(payload, seen) || !dedupeKey) return;
      remember(dedupeKey, seen);
      const activeConversation = isActiveConversation(window.location.pathname, payload.conversationId);
      if (payload.type === "read-receipt") {
        window.dispatchEvent(new CustomEvent("riezz99:realtime-read-receipt", { detail: payload }));
        return;
      }
      window.dispatchEvent(new CustomEvent("riezz99:realtime-unread", { detail: payload }));
      if (payload.type === "message") window.dispatchEvent(new CustomEvent("riezz99:realtime-message", { detail: payload }));
      if (activeConversation || !shouldShowIncomingToast(payload, window.location.pathname)) return;
      if (!payload.title) return;
      setToasts((current) => current.some((toast) => toast.id === dedupeKey) ? current : [...current.slice(-2), { id: dedupeKey, type: payload.type === "message" ? "message" : "info", title: payload.title!, body: payload.body, href: payload.href }]);
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== dedupeKey)), 5000);
    };
    window.addEventListener("riezz99:toast", onToast);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    source.addEventListener("ready", onReady);
    source.addEventListener("error", onError);
    source.addEventListener("notification", onEvent);
    source.addEventListener("message", onEvent);
    source.addEventListener("read-receipt", onEvent);
    return () => { if (syncTimer !== undefined) window.clearTimeout(syncTimer); window.removeEventListener("riezz99:toast", onToast); window.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onOnline); source.removeEventListener("ready", onReady); source.removeEventListener("error", onError); source.removeEventListener("notification", onEvent); source.removeEventListener("message", onEvent); source.removeEventListener("read-receipt", onEvent); source.close(); };
  }, [enabled]);
  return <>{children}<ToastStack toasts={toasts} dismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} /></>;
}
