"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function StoreChatButton({ sellerId }: { sellerId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function chat() { setBusy(true); setError(""); const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerId }) }); const data = await response.json(); if (response.status === 401) { router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`); return; } if (!response.ok) { setError(data.error ?? "Chat tidak dapat dibuka."); setBusy(false); return; } router.push(`/messages/${data.conversationId}`); }
  return <div><button type="button" onClick={chat} disabled={busy} className="min-h-12 rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-50">{busy ? "Membuka chat..." : "Chat Seller"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
