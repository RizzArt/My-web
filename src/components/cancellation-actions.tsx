"use client";

import { useState } from "react";

export function CancellationActions({ id, status }: { id: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "APPROVE" | "REJECT") {
    const adminNote = action === "REJECT" ? window.prompt("Catatan penolakan wajib diisi") : undefined;
    if (action === "REJECT" && !adminNote?.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/admin/cancellations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, adminNote }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) setMessage(data.error || "Action gagal."); else window.location.reload();
  }
  if (status !== "PENDING") return null;
  return <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => act("APPROVE")} className="rounded-full bg-ink px-3 py-2 text-xs font-bold text-white">Setujui</button><button disabled={busy} onClick={() => act("REJECT")} className="rounded-full border border-red-300 px-3 py-2 text-xs font-bold text-red-700">Tolak</button>{message && <span className="text-xs text-red-700">{message}</span>}</div>;
}
