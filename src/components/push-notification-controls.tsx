"use client";

import { useEffect, useState } from "react";

type Props = { userId: string; role: "CUSTOMER" | "SELLER" | "ADMIN"; compact?: boolean };
type BrowserState = { permission: NotificationPermission | "unsupported" | "unknown"; subscription: boolean; linkedToAccount: boolean; configured: boolean };

function supported() { return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function isIphoneOrIpad() { return typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)); }
function isStandalone() { return typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)); }

export function PushNotificationControls({ userId, role, compact = false }: Props) {
  const [state, setState] = useState<BrowserState>({ permission: "unknown", subscription: false, linkedToAccount: false, configured: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(true);
  const readStatus = async () => {
    setChecking(true);
    const permission = supported() ? Notification.permission : "unsupported";
    if (!supported()) { setState({ permission, subscription: false, linkedToAccount: false, configured: false }); setChecking(false); return; }
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      const response = await fetch(endpoint ? `/api/push/status?endpoint=${encodeURIComponent(endpoint)}` : "/api/push/status", { cache: "no-store" });
      const server = response.ok ? await response.json() : {};
      setState({ permission, subscription: Boolean(subscription && server.subscription), linkedToAccount: Boolean(subscription && server.linkedToAccount), configured: Boolean(server.configured) });
    } catch { setState((current) => ({ ...current, permission })); }
    finally { setChecking(false); }
  };

  useEffect(() => {
    if (supported()) {
      navigator.serviceWorker.getRegistration("/").then((registration) => registration?.pushManager.getSubscription()).then(async (subscription) => {
        if (subscription) await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.toJSON().keys, userAgent: navigator.userAgent }) }).catch(() => undefined);
        await readStatus();
      }).catch(() => undefined);
    } else void readStatus();
  }, [userId]);

  const active = state.permission === "granted" && state.subscription && state.linkedToAccount;
  const iosInstallRequired = isIphoneOrIpad() && !isStandalone();
  const unsupported = state.permission === "unsupported" || iosInstallRequired;

  async function enable() {
    if (!supported()) { setMessage(iosInstallRequired ? "Di iPhone/iPad, pilih Bagikan > Tambahkan ke Layar Utama, lalu buka dari ikonnya." : "Browser ini belum mendukung Web Push."); return; }
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Izin notifikasi belum diberikan.");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const configResponse = await fetch("/api/push/config", { cache: "no-store" });
      const config = await configResponse.json();
      if (!configResponse.ok || !config.publicKey) throw new Error("Push belum dikonfigurasi di server.");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
      const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.toJSON().keys, userAgent: navigator.userAgent }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Subscription gagal disimpan.");
      await readStatus(); setMessage("Notifikasi aktif di perangkat ini.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Notifikasi gagal diaktifkan."); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) { await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); }
      await readStatus(); setMessage("Notifikasi dimatikan di perangkat ini.");
    } catch { setMessage("Notifikasi gagal dimatikan. Coba lagi."); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/push/test", { method: "POST" }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Tes notifikasi gagal."); setMessage("Tes dikirim. Penerimaan notifikasi bergantung pada perangkat dan browser."); } catch (error) { setMessage(error instanceof Error ? error.message : "Tes notifikasi gagal."); } finally { setBusy(false); }
  }

  if (compact && !checking && !active && !dismissed) return <div className="push-invite mt-3 rounded-xl bg-sand px-3 py-2.5 text-xs"><div className="flex items-start justify-between gap-3"><p className="text-ink/70">Aktifkan notifikasi perangkat untuk menerima kabar penting.</p><button type="button" aria-label="Tutup ajakan notifikasi" onClick={() => setDismissed(true)} className="shrink-0 text-lg leading-3 text-ink/45 hover:text-ink">×</button></div><button type="button" onClick={enable} disabled={busy || unsupported} className="mt-2 rounded-full bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-40">Aktifkan</button>{unsupported && <p className="mt-2 text-ink/55">{iosInstallRequired ? "Di iPhone/iPad, pilih Bagikan > Tambahkan ke Layar Utama, lalu buka dari ikonnya." : "Browser ini belum mendukung Web Push."}</p>}</div>;
  return <section aria-label="Pengaturan notifikasi push" className="rounded-2xl border border-ink/10 bg-white p-4 shadow-soft"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Pengaturan notifikasi perangkat</h2><p className="mt-1 text-xs text-ink/60">Status: {active ? "Aktif di perangkat ini" : state.permission === "denied" ? "Izin browser ditolak" : "Belum aktif"}.</p><p className="mt-1 text-xs text-ink/60">Untuk {role === "ADMIN" ? "admin" : role === "SELLER" ? "seller" : "buyer"}; akun lain di perangkat ini tidak menerima notifikasi akun ini.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || active || unsupported} onClick={enable} className="rounded-full bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Aktifkan Notifikasi</button><button type="button" disabled={busy || !active} onClick={disable} className="rounded-full border border-ink/20 px-3 py-2 text-xs font-bold disabled:opacity-40">Matikan Notifikasi</button><button type="button" disabled={busy || !active} onClick={test} className="rounded-full border border-coral px-3 py-2 text-xs font-bold text-coral disabled:opacity-40">Tes Notifikasi</button></div></div>{unsupported && <p className="mt-3 text-xs text-ink/60">{iosInstallRequired ? "iPhone/iPad: pilih Bagikan > Tambahkan ke Layar Utama, lalu buka situs dari ikonnya." : "Browser ini belum mendukung Web Push."}</p>}{message && <p role="status" className="mt-3 text-xs text-ink/65">{message}</p>}</section>;
}

function decodeKey(value: string) { const padding = "=".repeat((4 - value.length % 4) % 4); const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (character) => character.charCodeAt(0)); }
