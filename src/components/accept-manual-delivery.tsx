"use client";

import { useEffect, useState } from "react";

export function AcceptManualDelivery({ orderId, deliveryId, autoAcceptAt }: { orderId: string; deliveryId: string; autoAcceptAt: Date }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState(() => Math.max(0, autoAcceptAt.getTime() - Date.now()));
  async function accept() {
    setBusy(true);
    const response = await fetch(`/api/orders/${orderId}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryId }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) window.location.reload();
    else { setMessage(result.error ?? "Pesanan tidak dapat diterima."); setBusy(false); }
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = Math.max(0, autoAcceptAt.getTime() - Date.now());
      setRemaining(next);
      if (next === 0) window.location.reload();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [autoAcceptAt]);
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return <div className="mt-4 rounded-xl border border-coral/25 bg-coral/5 p-4"><p className="text-sm font-semibold">Pesanan akan otomatis diterima dalam {hours} jam {minutes} menit</p><button type="button" onClick={() => setConfirming(true)} disabled={busy} className="mt-4 w-full rounded-full bg-coral px-5 py-3 text-sm font-bold text-white transition hover:bg-ink disabled:opacity-50">{busy ? "Memproses..." : "Terima Pesanan"}</button>{message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}{confirming && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 className="display text-xl font-bold">Terima pesanan?</h2><p className="mt-3 text-sm leading-6 text-ink/65">Pastikan produk digital sudah diterima dan dapat digunakan. Setelah pesanan diterima, transaksi akan diselesaikan.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirming(false)} className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold">Batal</button><button type="button" onClick={() => { setConfirming(false); void accept(); }} className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white">Terima Pesanan</button></div></div></div>}</div>;
}
