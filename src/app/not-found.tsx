import Link from "next/link";

export default function NotFound() { return <main className="mx-auto max-w-2xl px-5 py-24 text-center"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Riezz99</p><h1 className="display mt-4 text-5xl font-bold">Halaman tidak ditemukan</h1><p className="mt-4 text-ink/60">Tautan yang kamu buka mungkin sudah berubah atau tidak tersedia.</p><Link href="/" className="mt-8 inline-flex rounded-full bg-ink px-6 py-3 font-bold text-white">Kembali ke Beranda</Link></main>; }
