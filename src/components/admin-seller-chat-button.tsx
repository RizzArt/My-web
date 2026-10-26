"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminSellerChatButton({ sellerId }: { sellerId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function openChat() { setBusy(true); setError(""); const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerId, adminSupport: true }) }); const data = await response.json().catch(() => ({})); if (response.ok) router.push(`/admin/messages/${data.conversationId}`); else setError(data.error ?? "Chat seller tidak dapat dibuka."); setBusy(false); }
  return <div><button type="button" disabled={busy} onClick={() => void openChat()} className="rounded-full bg-coral px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? "Membuka..." : "Chat Seller"}</button>{error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}</div>;
}
