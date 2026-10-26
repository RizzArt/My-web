"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefundForm({ orderId, deadline }: { orderId: string; deadline: string }) {
  const router = useRouter();
  const [method, setMethod] = useState("ACCOUNT_BALANCE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget)); data.method = method;
    const response = await fetch(`/api/orders/${orderId}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setError(result.error ?? "Pengajuan refund gagal."); return; }
    router.refresh();
  }
  return <form onSubmit={submit} className="mt-5 rounded-2xl border border-coral/20 bg-coral/5 p-5"><h3 className="font-bold">Ajukan Refund</h3><p className="mt-1 text-sm text-ink/60">Tersedia sampai: {deadline}</p><label className="mt-4 block text-sm font-semibold">Alasan refund<textarea required name="reason" maxLength={1000} className="mt-2 min-h-24 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-normal" /></label><fieldset className="mt-4"><legend className="text-sm font-semibold">Metode pengembalian</legend><label className="mt-2 flex gap-2 text-sm"><input type="radio" checked={method === "ACCOUNT_BALANCE"} onChange={() => setMethod("ACCOUNT_BALANCE")} />Saldo Akun</label><p className="ml-6 text-xs text-ink/55">Dana akan masuk ke saldo akun setelah refund disetujui admin.</p><label className="mt-3 flex gap-2 text-sm"><input type="radio" checked={method === "MANUAL_TRANSFER"} onChange={() => setMethod("MANUAL_TRANSFER")} />Rekening / E-wallet</label></fieldset>{method === "MANUAL_TRANSFER" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><select required name="payoutType" className="rounded-xl border border-ink/15 bg-white px-4 py-3"><option value="BANK">Bank</option><option value="EWALLET">E-wallet</option></select><input required name="payoutProvider" placeholder="Nama bank / e-wallet" maxLength={120} className="rounded-xl border border-ink/15 px-4 py-3" /><input required name="payoutAccountNumber" placeholder="Nomor rekening / e-wallet" maxLength={80} className="rounded-xl border border-ink/15 px-4 py-3" /><input required name="payoutAccountName" placeholder="Nama pemilik" maxLength={120} className="rounded-xl border border-ink/15 px-4 py-3" /></div>}<button disabled={busy} className="mt-5 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Mengirim..." : "Kirim Pengajuan"}</button>{error && <p className="mt-3 text-sm text-red-700">{error}</p>}</form>;
}
