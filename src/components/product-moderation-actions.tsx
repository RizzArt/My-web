"use client";

import { useState } from "react";

export function ProductModerationActions({ productId, status }: { productId: string; status: string }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [reason, setReason] = useState("");
  async function moderate(nextStatus: "APPROVED" | "REJECTED") {
    if (nextStatus === "REJECTED" && reason.trim().length < 3) { setMessage("Alasan penolakan minimal 3 karakter."); return; }
    if (nextStatus === "APPROVED" && !window.confirm("Approve produk ini? Produk akan aktif di storefront.")) return;
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/admin/products/${productId}/moderation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus, rejectionReason: nextStatus === "REJECTED" ? reason : undefined }) }); const result = await response.json().catch(() => ({})); if (!response.ok) setMessage(result.error || "Moderation gagal."); else window.location.reload(); } catch { setMessage("Tidak dapat terhubung ke server."); } finally { setBusy(false); }
  }
  if (status !== "PENDING_REVIEW") return <p className="rounded-xl bg-sand p-4 text-sm">Status moderation: <strong>{status}</strong></p>;
  return <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Produk seller menunggu moderation.</p><label className="mt-4 grid gap-2 text-sm font-semibold">Alasan penolakan<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Wajib diisi jika produk ditolak" className="min-h-24 rounded-xl border border-ink/15 bg-white px-3 py-2 font-normal" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void moderate("APPROVED")} className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Approve Product</button><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void moderate("REJECTED")} className="rounded-full border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">Reject Product</button></div>{message && <p role="status" className="mt-3 text-sm text-red-700">{message}</p>}</div>;
}
