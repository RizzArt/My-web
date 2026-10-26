"use client";

import { useState } from "react";

export function BroadcastForm() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(raw) });
    const result = await response.json();
    if (response.ok) {
      event.currentTarget.reset();
      setFeedback(`Broadcast terkirim ke ${result.broadcast.recipientCount} penerima.`);
      window.location.reload();
    } else setFeedback(result.error ?? "Broadcast gagal dikirim.");
    setBusy(false);
  }
  return <form onSubmit={submit} className="mt-10 rounded-2xl bg-white p-6 shadow-soft sm:p-8"><h2 className="display text-2xl font-bold">Buat broadcast</h2><div className="mt-5 grid gap-5"><label className="text-sm font-semibold">Title<input name="title" required maxLength={120} className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><label className="text-sm font-semibold">Message<textarea name="message" required maxLength={2000} rows={4} className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><fieldset><legend className="text-sm font-semibold">Target audience</legend><div className="mt-3 grid gap-2 sm:grid-cols-3"><label className="flex gap-3 rounded-xl border border-ink/10 p-3 text-sm"><input type="radio" name="targetAudience" value="ALL" defaultChecked /> <span><strong className="block">Semua User</strong><span className="text-ink/55">Customer dan Seller</span></span></label><label className="flex gap-3 rounded-xl border border-ink/10 p-3 text-sm"><input type="radio" name="targetAudience" value="CUSTOMER" /> <span><strong className="block">Customer</strong><span className="text-ink/55">Hanya akun customer</span></span></label><label className="flex gap-3 rounded-xl border border-ink/10 p-3 text-sm"><input type="radio" name="targetAudience" value="SELLER" /> <span><strong className="block">Seller</strong><span className="text-ink/55">Hanya akun seller</span></span></label></div></fieldset><label className="text-sm font-semibold">Optional link<input name="link" type="text" placeholder="/dashboard atau /products" className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /><span className="mt-1 block text-xs font-normal text-ink/50">Gunakan path internal yang diawali /.</span></label></div><button disabled={busy} className="mt-6 rounded-full bg-ink px-6 py-3 font-bold text-white transition hover:bg-coral disabled:opacity-50">{busy ? "Mengirim..." : "Send Broadcast"}</button>{feedback && <p role="status" className="mt-4 rounded-xl bg-mint p-4 text-sm">{feedback}</p>}</form>;
}
