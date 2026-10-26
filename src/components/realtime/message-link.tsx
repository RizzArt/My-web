"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function MessageLink({ href }: { href: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = async () => { const response = await fetch("/api/conversations", { cache: "no-store" }); if (response.ok) { const data = await response.json() as { conversations?: Array<{ unreadCount?: number }> }; setCount((data.conversations ?? []).reduce((total, item) => total + (item.unreadCount ?? 0), 0)); } };
    void refresh();
    const listener = () => { void refresh(); };
    window.addEventListener("riezz99:realtime-unread", listener);
    return () => window.removeEventListener("riezz99:realtime-unread", listener);
  }, []);
  return <Link href={href as never} aria-label="Buka pesan" className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink/15 bg-white transition hover:border-coral focus:outline-none focus:ring-2 focus:ring-coral"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" /><path strokeLinecap="round" d="M7.5 10.5h9M7.5 13.5h5" /></svg><span className="sr-only">Pesan</span>{count > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-coral px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">{count > 99 ? "99+" : count}</span>}</Link>;
}
