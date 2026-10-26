"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatAdminButton } from "./chat-admin-button";

type Conversation = { id: string; unreadCount: number; adminSupport?: boolean; product?: { name: string } | null; seller?: { storeName: string; userId?: string } | null; customer?: { name: string | null; email?: string } | null; messages: Array<{ content: string; attachments?: Array<{ kind: "IMAGE" | "VIDEO" }> }> };

export function MessagesPage({ basePath = "/messages", role = "CUSTOMER" }: { basePath?: string; role?: "CUSTOMER" | "SELLER" | "ADMIN" }) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/conversations"); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Chat gagal dimuat."); setItems(data.conversations ?? []); }
    catch { setError("Percakapan belum dapat dimuat. Periksa koneksi dan coba lagi."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function remove(id: string) { if (!window.confirm("Hapus chat ini dari daftar kamu?")) return; const response = await fetch(`/api/conversations/${id}/messages`, { method: "DELETE" }); if (response.ok) setItems((current) => current.filter((item) => item.id !== id)); else setError("Chat gagal dihapus."); }
  const support = items.find((item) => item.adminSupport && (role !== "SELLER" || Boolean(item.seller)) && (role !== "CUSTOMER" || !item.seller));
  return <main className="mx-auto max-w-3xl px-5 py-12 sm:py-20"><p className="text-xs font-bold uppercase tracking-[.2em] text-coral">Kotak masuk</p><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="display mt-3 text-5xl font-bold">Pesan</h1><p className="mt-2 text-sm text-ink/60">Chat dengan pembeli, penjual, atau Admin Riezz99.</p></div>{role !== "ADMIN" && <ChatAdminButton basePath={basePath} existingId={support?.id} />}</div><div className="mt-8 overflow-hidden rounded-2xl bg-white shadow-soft">{loading ? <p role="status" className="p-8 text-center text-sm text-ink/60">Memuat percakapan…</p> : error ? <div className="ui-state" role="alert"><h2 className="font-bold">Percakapan belum tersedia</h2><p>{error}</p><button type="button" onClick={() => void load()}>Coba lagi</button></div> : items.length ? <div className="divide-y divide-ink/10">{items.map((item) => <div key={item.id} className={`flex items-center gap-3 px-5 py-5 transition hover:bg-sand ${item.unreadCount ? "border-l-4 border-coral bg-coral/5" : ""}`}><Link href={`${basePath}/${item.id}` as never} className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{item.adminSupport ? (item.seller ? role === "SELLER" ? "Admin Riezz99" : `Penjual - ${item.seller.storeName}` : role === "ADMIN" ? `Pembeli - ${item.customer?.name ?? "Pembeli"}` : "Admin Riezz99") : item.seller?.storeName ?? item.customer?.name ?? "Bantuan Riezz99"}</p>{item.unreadCount > 0 && <span className="rounded-full bg-coral px-2 py-0.5 text-[10px] font-bold text-white">{item.unreadCount > 99 ? "99+" : item.unreadCount} baru</span>}</div><p className="mt-1 text-sm text-ink/60">{item.adminSupport ? (item.seller ? role === "SELLER" ? "Admin" : "Penjual" : "Pembeli") : item.product?.name ?? "Bantuan"}</p><p className={`mt-2 truncate text-sm ${item.unreadCount ? "font-semibold" : ""}`}>{item.messages[0]?.content || (item.messages[0]?.attachments?.some((attachment) => attachment.kind === "VIDEO") ? "Video" : item.messages[0]?.attachments?.length ? "Gambar" : "Belum ada pesan")}</p></Link><button type="button" onClick={() => void remove(item.id)} className="shrink-0 rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50">Hapus</button></div>)}</div> : <div className="px-5 py-14 text-center"><p className="text-3xl" aria-hidden="true">✉</p><p className="mt-3 font-bold">Belum ada chat</p><p className="mt-1 text-sm text-ink/55">Percakapan baru akan muncul di sini.</p></div>}</div></main>;
}
