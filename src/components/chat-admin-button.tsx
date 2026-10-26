"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChatAdminButton({ basePath, existingId }: { basePath: string; existingId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openChat() {
    if (existingId) { router.push(`${basePath}/${existingId}` as never); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminSupport: true }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) router.push(`${basePath}/${data.conversationId}` as never);
    else setError(data.error ?? "Chat Admin tidak dapat dibuka.");
    setBusy(false);
  }
  return <div><button type="button" onClick={() => void openChat()} disabled={busy} className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-coral disabled:opacity-50">{busy ? "Membuka..." : existingId ? "Buka Chat Admin" : "Chat Admin"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
