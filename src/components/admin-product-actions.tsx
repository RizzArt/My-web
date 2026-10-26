"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminProductActions({ productId, archived, hasHistory }: { productId: string; archived: boolean; hasHistory: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function archive() {
    const reason = window.prompt("Alasan archive (opsional):", "Produk melanggar kebijakan marketplace.");
    if (reason === null) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/products/${productId}/archive`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ARCHIVE", reason }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error ?? "Produk gagal diarsipkan."); else router.refresh();
    setBusy(false);
  }
  async function restore() {
    if (!window.confirm("Pulihkan produk ini? Status moderation tetap menjadi penentu publikasi.")) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/products/${productId}/archive`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RESTORE" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error ?? "Produk gagal dipulihkan."); else router.refresh();
    setBusy(false);
  }
  async function remove() {
    if (!window.confirm("Hapus produk secara permanen?\n\nTindakan ini tidak dapat dibatalkan.")) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error ?? "Produk tidak dapat dihapus permanen."); else router.refresh();
    setBusy(false);
  }
  return <div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void (archived ? restore() : archive())} className="rounded-full bg-coral px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{archived ? "Pulihkan Produk" : "Arsipkan"}</button>{!hasHistory && <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-full border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">Hapus Permanen</button>}{error && <p role="alert" className="basis-full text-sm text-red-700">{error}</p>}</div>;
}
