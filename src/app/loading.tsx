export default function Loading() {
  return <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true" aria-label="Memuat halaman"><p role="status" className="font-semibold">Memuat halaman…</p><div aria-hidden="true" className="mt-6 grid animate-pulse grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="rounded-2xl border border-ink/10 bg-white p-3"><div className="aspect-square rounded-xl bg-sand" /><div className="mt-3 h-4 w-3/4 rounded bg-sand" /><div className="mt-3 h-4 w-1/2 rounded bg-sand" /></div>)}</div></main>;
}
