"use client";
import { useState, useTransition } from "react";
import { retryOrderEmail } from "@/app/admin/orders/actions";

export function AdminRetryEmailButton({ orderId }: { orderId: string }) { const [pending, startTransition] = useTransition(); const [message, setMessage] = useState(""); function retry() { setMessage(""); startTransition(async () => { const result = await retryOrderEmail(orderId); setMessage(result.ok ? "Email dikirim ulang." : result.error); }); } return <div><button type="button" onClick={retry} disabled={pending} className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{pending ? "Memproses..." : "Retry"}</button>{message && <p className="mt-1 text-xs text-ink/60">{message}</p>}</div>; }
