"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function OrderCancellationActions({ orderId, orderStatus, paymentStatus, hasFulfilledDelivery }: { orderId: string; orderStatus: string; paymentStatus: string | null; hasFulfilledDelivery: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const unpaid = orderStatus === "PENDING" && ["PENDING", "FAILED", "EXPIRED"].includes(paymentStatus ?? "");
  const paidReview = ["PAID", "PROCESSING"].includes(orderStatus) && paymentStatus === "PAID" && !hasFulfilledDelivery;
  if (!unpaid && !paidReview) return null;
  async function cancel() {
    const reason = paidReview ? window.prompt("Alasan pembatalan wajib diisi") : undefined;
    if (paidReview && !reason?.trim()) return;
    if (unpaid && !window.confirm("Batalkan pesanan ini?\n\nPesanan yang dibatalkan tidak dapat dilanjutkan. Jangan membayar QRIS atau invoice lama setelah pembatalan.")) return;
    setBusy(true); const response = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reason ? { reason } : {}) }); const data = await response.json(); setBusy(false);
    if (!response.ok) setMessage(data.error || "Pembatalan gagal."); else router.refresh();
  }
  return <div><button type="button" onClick={cancel} disabled={busy} className="rounded-full border border-red-300 px-5 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">{busy ? "Memproses..." : paidReview ? "Ajukan Pembatalan" : "Batalkan Pesanan"}</button>{message && <p className="mt-2 text-sm text-red-700">{message}</p>}</div>;
}
