"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { readIpaymuPaymentView } from "@/lib/payments/ipaymu-view";

type View = Awaited<ReturnType<typeof readIpaymuPaymentView>>;
const rupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export function IpaymuPayment({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const response = await fetch(`/api/orders/${orderId}/ipaymu`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Informasi VA belum tersedia.");
    const data: View = await response.json();
    setView(data);
    return data;
  }, [orderId]);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/orders/${orderId}/ipaymu`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const data: View = await response.json();
        if (alive) setView(data);
      } catch {
        if (alive) setMessage("Informasi VA belum dapat dimuat.");
      }
    }
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 10000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [orderId]);

  useEffect(() => {
    if (view?.status === "PAID" || view?.orderStatus === "CANCELLED") {
      router.refresh();
    }
  }, [view?.status, view?.orderStatus, router]);

  async function act(action: "create" | "check") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${orderId}/ipaymu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || "Permintaan belum selesai.");
      } else {
        setView(result as View);
        if (action === "check") {
          setMessage(result.status === "PAID"
            ? "Pembayaran berhasil."
            : "Status pembayaran sudah diperiksa.");
        }
      }
    } catch {
      setMessage("Koneksi terputus. Muat ulang untuk memeriksa status VA.");
    } finally {
      try { await load(); } catch { /* Pesan permintaan tetap ditampilkan. */ }
      setBusy(false);
      router.refresh();
    }
  }

  const seconds = view ? Math.max(0, Math.ceil(
    (view.deadlineAt - now) / 1000,
  )) : 0;
  const open = Boolean(view?.open && seconds > 0);
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return <section className="mt-8 border-t border-ink/10 pt-6">
    <h2 className="text-xl font-bold">Virtual Account iPaymu</h2>
    {view ? <>
      <div className="mt-4 space-y-2 rounded-xl bg-sand p-4 text-sm">
        <p>Bank: <strong>{view.bankName}</strong></p>
        <p>Harga produk: <strong>{rupiah(view.amount)}</strong></p>
        <p>Biaya admin ditanggung pembeli: <strong>{rupiah(view.fee)}</strong></p>
        <p>Total pembayaran VA: <strong>{rupiah(view.total)}</strong></p>
        {open && <p>Sisa waktu: <strong>{countdown}</strong></p>}
      </div>

      {view.status === "PAID" ? <p className="mt-4 font-semibold">
        Pembayaran berhasil.
      </p> : <>
        {!open && <p className="mt-4 text-sm">
          Pembayaran pesanan ini sudah ditutup. Jangan transfer ke nomor VA lama.
        </p>}
        {open && view.phase === "draft" && <button
          type="button" disabled={busy || !view.enabled || seconds < 60}
          onClick={() => act("create")}
          className="mt-4 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >{busy ? "Memproses…" : "Buat Nomor VA"}</button>}
        {open && view.phase === "draft" && !view.enabled &&
          <p className="mt-3 text-sm">Pembayaran VA belum diaktifkan.</p>}
        {view.phase === "creating" && <p className="mt-4 text-sm">
          Permintaan VA sudah dikirim; hasilnya belum tersedia.
          Jangan membuat pembayaran baru. Hubungi admin jika status ini menetap.
        </p>}
        {open && view.invoice && <div className="mt-4 rounded-xl border border-ink/15 p-4">
          <p className="text-sm">Nomor Virtual Account</p>
          <p className="mt-2 break-all text-xl font-bold">{view.invoice.paymentNo}</p>
          <p className="mt-3 text-sm">Transfer tepat {rupiah(view.total)} sebelum waktu habis.</p>
        </div>}
        {view.phase === "active" && <button
          type="button" disabled={busy}
          onClick={() => act("check")}
          className="mt-4 rounded-full border border-ink/20 px-5 py-3 text-sm font-bold disabled:opacity-50"
        >{busy ? "Memeriksa…" : "Periksa Pembayaran"}</button>}
      </>}
    </> : <p className="mt-4 text-sm">Memuat informasi VA…</p>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
  </section>;
}
