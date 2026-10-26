"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Qr = {
  qrImage: string;
  invoiceId: string;
  amount: number;
  totalPay: number;
  createdAt: number;
};

export function SociaBuzzPayment({
  orderId,
  locked,
  amount,
  deadlineAt,
}: {
  orderId: string;
  locked: boolean;
  amount: number;
  deadlineAt: number;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<Qr | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const checking = useRef(false);
  const restored = useRef(false);

  const endpoint = `/api/orders/${encodeURIComponent(orderId)}/sociabuzz`;

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Status belum tersedia.");
      if (result.status === "PAID") {
        setMessage("Pembayaran berhasil. Pesanan sedang diperbarui.");
        router.refresh();
      } else if (["EXPIRED", "FAILED", "CANCELLED"].includes(result.status)) {
        setMessage("Invoice sudah berakhir. Halaman pesanan sedang diperbarui.");
        router.refresh();
      } else {
        setMessage("Pembayaran belum terkonfirmasi. Status diperiksa otomatis.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status belum tersedia.");
    } finally {
      checking.current = false;
    }
  }, [endpoint, router]);

  const create = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "QRIS belum tersedia.");
      setQr(result as Qr);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "QRIS belum tersedia.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }, [endpoint, router]);

  useEffect(() => {
    if (locked && !restored.current) {
      restored.current = true;
      void create();
    }
  }, [locked, create]);

  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [qr]);

  useEffect(() => {
    if (!locked && !qr) return;
    const timer = window.setInterval(() => void check(), 10000);
    return () => window.clearInterval(timer);
  }, [locked, qr, check]);

  const seconds = Math.max(0, Math.floor((deadlineAt - now) / 1000));
  const expired = seconds <= 0;
  const eligible = amount > 0 && amount % 1000 === 0;

  return <section className="mt-8 border-t border-ink/10 pt-6">
    <h2 className="text-xl font-bold">Bayar dengan QRIS</h2>
    {!qr && <div className="mt-4 space-y-3">
      <p className="text-sm leading-6 text-ink/65">
        Siapkan aplikasi bank atau e-wallet sebelum membuat QR.
        Total akhir termasuk biaya pembayaran akan ditampilkan bersama QRIS.
      </p>
      {!eligible && <p className="text-sm text-red-700">
        QRIS ini memerlukan total kelipatan Rp1.000. Gunakan Saldo Akun.
      </p>}
      <button
        type="button"
        disabled={busy || !eligible || expired}
        onClick={() => void create()}
        className="rounded-full bg-coral px-6 py-3 font-bold text-white disabled:opacity-50"
      >{expired ? "Batas 10 menit terlewati" : busy ? "Menyiapkan QRIS..." : locked ? "Tampilkan kembali QRIS" : "Buat QRIS"}</button>
    </div>}
    {qr && <div className="mt-4 rounded-2xl bg-sand p-4 text-center">
      {seconds > 0 && !expired ? <>
        <Image
          src={qr.qrImage}
          alt="QRIS pembayaran pesanan"
          width={360}
          height={360}
          unoptimized
          className="mx-auto h-auto w-full max-w-[320px] rounded-xl bg-white"
        />
        <p className="mt-3 text-sm font-semibold">
          Segera bayar · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </p>
      </> : <p className="rounded-xl bg-white p-4 text-sm">
        QR sudah melewati batas waktu tampilan. Jika sudah membayar,
        periksa status dan jangan melakukan pembayaran ulang.
        Jika status tetap pending, hubungi admin melalui menu Pesan.
      </p>}
      <p className="mt-4 text-sm text-ink/65">Total pembayaran QRIS</p>
      <p className="mt-1 text-2xl font-bold">
        Rp {qr.totalPay.toLocaleString("id-ID")}
      </p>
      <p className="mt-2 text-xs text-ink/60">
        Harga pesanan Rp {qr.amount.toLocaleString("id-ID")} ·
        Biaya pembayaran Rp {(qr.totalPay - qr.amount).toLocaleString("id-ID")}
      </p>
      <p className="mt-3 break-all text-xs text-ink/55">{qr.invoiceId}</p>
      <p className="mt-3 text-sm">Pembayaran diverifikasi otomatis.</p>
    </div>}
    {(locked || qr) && <button
      disabled={false}
      type="button"
      onClick={() => void check()}
      className="mt-4 rounded-full border border-ink/20 px-5 py-2.5 text-sm font-bold"
    >Periksa pembayaran</button>}
    {expired && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Batas pembayaran adalah 10 menit sejak pesanan dibuat. Jangan melakukan pembayaran baru.</p>}
    {message && <p role="status" className="mt-3 text-sm text-ink/70">{message}</p>}
  </section>;
}
