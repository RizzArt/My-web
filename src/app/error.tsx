"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="mx-auto max-w-2xl px-5 py-24 text-center"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Riezz99</p><h1 className="display mt-4 text-5xl font-bold">Terjadi kendala</h1><p className="mt-4 text-ink/60">Silakan coba lagi atau kembali ke halaman utama.</p><button onClick={reset} className="mt-6 rounded-xl bg-coral px-6 py-3 font-bold text-white">Coba lagi</button><br /><Link href="/" className="mt-4 inline-flex rounded-full bg-ink px-6 py-3 font-bold text-white">Kembali ke Beranda</Link></main>; }
