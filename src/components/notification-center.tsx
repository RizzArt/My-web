"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PushNotificationControls } from "./push-notification-controls";

type NotificationItem = { id: string; title: string; message: string; link: string | null; isRead: boolean; createdAt: string };

export function NotificationCenter({ initialNotifications, initialUnreadCount, userId, role }: { initialNotifications: NotificationItem[]; initialUnreadCount: number; userId: string; role: "CUSTOMER" | "SELLER" | "ADMIN" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [busy, setBusy] = useState(false);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) { refreshQueuedRef.current = true; return; }
    refreshInFlightRef.current = true;
    try {
      const response = await fetch("/api/notifications?limit=5", { cache: "no-store" });
      if (response.ok) { const data = await response.json(); setItems(data.notifications ?? []); setUnreadCount(data.unreadCount ?? 0); }
    } catch { /* Keep the last notification snapshot during transient failures. */ }
    finally { refreshInFlightRef.current = false; if (refreshQueuedRef.current) { refreshQueuedRef.current = false; void refresh(); } }
  }, []);
  useEffect(() => {
    const listener = () => { void refresh(); };
    window.addEventListener("riezz99:realtime-unread", listener);
    window.addEventListener("riezz99:realtime-sync", listener);
    let pollTimer: number | undefined;
    const updatePolling = () => {
      if (pollTimer !== undefined) { window.clearInterval(pollTimer); pollTimer = undefined; }
      if (document.visibilityState === "visible" && navigator.onLine) pollTimer = window.setInterval(() => { void refresh(); }, 15000);
    };
    updatePolling();
    document.addEventListener("visibilitychange", updatePolling);
    window.addEventListener("online", updatePolling);
    window.addEventListener("offline", updatePolling);
    void refresh();
    return () => { if (pollTimer !== undefined) window.clearInterval(pollTimer); document.removeEventListener("visibilitychange", updatePolling); window.removeEventListener("online", updatePolling); window.removeEventListener("offline", updatePolling); window.removeEventListener("riezz99:realtime-unread", listener); window.removeEventListener("riezz99:realtime-sync", listener); };
  }, [refresh]);
  const markRead = async (id?: string) => {
    if (busy) return;
    setBusy(true);
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : {}) });
    if (response.ok) {
      setItems((current) => current.map((item) => id && item.id !== id ? item : { ...item, isRead: true }));
      setUnreadCount((current) => id ? Math.max(0, current - (items.find((item) => item.id === id)?.isRead ? 0 : 1)) : 0);
    }
    setBusy(false);
  };
  const renderItem = (item: NotificationItem) => {
    const content = <div className={`rounded-xl p-3 transition hover:bg-sand ${item.isRead ? "" : "bg-coral/10"}`}><div className="flex items-start justify-between gap-3"><p className="text-sm font-bold">{item.title}</p>{!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Belum dibaca" />}</div><p className="mt-1 text-sm leading-5 text-ink/65">{item.message}</p><time className="mt-2 block text-[11px] text-ink/45" dateTime={item.createdAt}>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time></div>;
    return item.link ? <Link key={item.id} href={item.link as never} onClick={() => { void markRead(item.id); setOpen(false); }}>{content}</Link> : <button key={item.id} type="button" className="block w-full text-left" onClick={() => void markRead(item.id)}>{content}</button>;
  };
  return <div className="relative"><button type="button" aria-label="Buka notifikasi" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 bg-white transition hover:border-coral focus:outline-none focus:ring-2 focus:ring-coral"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span className="sr-only">Notifikasi</span>{unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-coral px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>{open && <div className="fixed inset-x-3 top-[4.75rem] z-[90] rounded-2xl border border-ink/10 bg-white p-3 shadow-2xl sm:absolute sm:right-0 sm:top-14 sm:w-96 sm:left-auto"><div className="flex items-center justify-between gap-3 px-2 pb-2"><h2 className="display text-lg font-bold">Notifikasi</h2>{unreadCount > 0 && <button type="button" disabled={busy} onClick={() => void markRead()} className="text-xs font-bold text-coral disabled:opacity-50">Tandai semua dibaca</button>}</div><div className="max-h-[min(65vh,28rem)] space-y-1 overflow-y-auto">{items.length ? items.map(renderItem) : <p className="px-2 py-8 text-center text-sm text-ink/55">Belum ada notifikasi.</p>}</div><div className="mt-3 border-t border-ink/10 pt-3"><p className="px-2 text-xs font-bold uppercase tracking-widest text-coral">Pengaturan perangkat</p><PushNotificationControls userId={userId} role={role} compact /><details className="mt-2"><summary className="cursor-pointer rounded-xl px-2 py-2 text-sm font-semibold hover:bg-sand">Pengaturan notifikasi perangkat</summary><div className="mt-2"><PushNotificationControls userId={userId} role={role} /></div></details></div></div>}</div>;
}
