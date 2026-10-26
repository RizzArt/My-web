"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { generationFailureMessage } from "@/lib/studio/generation-error";

type Model = {
  provider: string;
  model: string;
  displayName: string;
  creditCostPerImage: number;
  supportsReferenceImage: boolean;
  supportedAspectRatios: string[];
};

type Output = { id: string };

type Generation = {
  id: string;
  provider: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  outputCount: number;
  status: string;
  creditCost: number;
  errorMessage?: string | null;
  createdAt: string;
  outputs: Output[];
};

function StudioIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3 9.8 8.2 4.5 10.5l5.3 2.2L12 18l2.2-5.3 5.3-2.2-5.3-2.3L12 3Z" /><path d="m5 3 .7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7L5 3Z" /></svg>;
}

function ImageIcon() {
  return <svg aria-hidden="true" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 17 4.7-4.7a2 2 0 0 1 2.8 0L14 14.8l1.2-1.2a2 2 0 0 1 2.8 0L20 15.7" /></svg>;
}

function RefreshIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 8M5.5 15A7 7 0 0 0 17.8 17.8L20 16" /></svg>;
}

function DownloadIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7" /><path d="M10 11v5m4-5v5" /></svg>;
}

function statusClass(status: string) {
  if (status === "COMPLETED") return "studio-pro-status studio-pro-status--completed";
  if (status === "FAILED") return "studio-pro-status studio-pro-status--failed";
  return "studio-pro-status studio-pro-status--processing";
}

export function StudioPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [history, setHistory] = useState<Generation[]>([]);
  const [credits, setCredits] = useState(0);
  const [modelKey, setModelKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [count, setCount] = useState(1);
  const [reference, setReference] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const deletedIdsRef = useRef(new Set<string>());
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);

  const selected = useMemo(() => models.find((item) => `${item.provider}:${item.model}` === modelKey), [models, modelKey]);
  const latestWithOutput = useMemo(() => history.find((item) => item.outputs.length > 0), [history]);
  const isSekai = selected?.provider === "SEKAI";
  const constrainedCount = isSekai ? 1 : count;
  const cost = (selected?.creditCostPerImage ?? 0) * constrainedCount;

  async function refresh() {
    const response = await fetch("/api/studio/generations", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setModels(data.models);
    setHistory(data.generations.filter((generation: Generation) => !deletedIdsRef.current.has(generation.id)));
    setCredits(data.credits);
    setModelKey((current) => current || (data.models[0] ? `${data.models[0].provider}:${data.models[0].model}` : ""));
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (selected && !selected.supportedAspectRatios.includes(ratio)) setRatio(selected.supportedAspectRatios[0] ?? "1:1");
    if (selected && !selected.supportsReferenceImage) setReference(null);
    if (isSekai) { setRatio("1:1"); setCount(1); }
  }, [selected, ratio, isSekai]);

  async function topUp() {
    setTopUpBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/studio/top-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageCode: "STUDIO_100" }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.redirectUrl !== "string") throw new Error(result.error || "Top up belum dapat dibuat.");
      window.location.assign(result.redirectUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Top up belum dapat dibuat.");
    } finally {
      setTopUpBusy(false);
    }
  }

  async function deleteGeneration(item: Generation) {
    if (busy || topUpBusy || deletingId) return;
    const detail = item.status === "COMPLETED" ? "Gambar hasil akan dihapus permanen." : "Catatan generation gagal akan dihapus dari galeri.";
    if (!window.confirm(`Hapus generation ini? ${detail} Studio Credit dan riwayat transaksi tidak berubah.`)) return;
    setDeletingId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/studio/generations/${item.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Generation gagal dihapus.");
      deletedIdsRef.current.add(item.id);
      setHistory((current) => current.filter((generation) => generation.id !== item.id));
      setMessage("Generation berhasil dihapus.");
      historyHeadingRef.current?.focus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Generation gagal dihapus.");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      let referenceStorageKey: string | undefined;
      if (reference && selected.supportsReferenceImage) {
        const form = new FormData();
        form.set("file", reference);
        const uploaded = await fetch("/api/studio/reference", { method: "POST", body: form });
        const result = await uploaded.json();
        if (!uploaded.ok) throw new Error(generationFailureMessage(result));
        referenceStorageKey = result.storageKey;
      }
      const response = await fetch("/api/studio/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selected.provider,
          model: selected.model,
          prompt,
          aspectRatio: isSekai ? "1:1" : ratio,
          outputCount: constrainedCount,
          referenceStorageKey,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(generationFailureMessage(result));
      setMessage("Generation selesai.");
      setPrompt("");
      setReference(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "Generation gagal.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return <main className="studio-pro-shell min-h-screen px-4 py-6 text-white sm:px-6 sm:py-8 lg:px-8">
    <div className="relative z-10 mx-auto max-w-[1600px]">
      <header className="studio-pro-header flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-violet-300"><StudioIcon className="h-4 w-4" />Riezz99 Creative Suite</div>
          <h1 className="mt-3 text-3xl font-medium tracking-[-.04em] text-white sm:text-4xl">AI Studio</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Generate visual berkualitas tinggi, kelola hasil privat, dan unduh karya dari satu workspace.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="studio-pro-credit" aria-label={`${credits} Studio Credit tersedia`}><span className="text-xs uppercase tracking-[.16em] text-slate-400">Credits</span><strong>{credits}</strong></div>
          <button type="button" disabled={topUpBusy || busy || deletingId !== null} onClick={() => void topUp()} className="studio-pro-topup">{topUpBusy ? "Menyiapkan..." : "Top Up 100 Credits"}<span>Rp10.000</span></button>
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-28">
          <form onSubmit={submit} aria-busy={busy} className="studio-pro-panel overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="studio-pro-eyebrow">Control panel</p>
              <h2 className="mt-1 text-lg font-medium tracking-[-.02em]">Create image</h2>
            </div>

            <div className="space-y-5 p-5">
              {!models.length ? <p className="studio-pro-notice">Belum ada model aktif. Hubungi admin.</p> : <>
                <label className="studio-pro-field">
                  <span className="studio-pro-label">Model</span>
                  <select value={modelKey} onChange={(event) => setModelKey(event.target.value)} className="studio-pro-input">
                    {models.map((item) => <option key={`${item.provider}:${item.model}`} value={`${item.provider}:${item.model}`}>{item.provider} · {item.displayName} · {item.creditCostPerImage} credit</option>)}
                  </select>
                </label>

                <label className="studio-pro-field">
                  <span className="flex items-center justify-between gap-3"><span className="studio-pro-label">Prompt</span><span className="text-xs text-slate-500">{prompt.length}/4000</span></span>
                  <textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} rows={7} placeholder="Deskripsikan visual, gaya, pencahayaan, warna, dan detail yang Anda inginkan..." className="studio-pro-input studio-pro-textarea" />
                </label>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
                  <label className="studio-pro-field">
                    <span className="studio-pro-label">Aspect ratio</span>
                    <select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={isSekai} className="studio-pro-input">
                      {selected?.supportedAspectRatios.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="studio-pro-field">
                    <span className="studio-pro-label">Output</span>
                    <select value={constrainedCount} onChange={(event) => setCount(Number(event.target.value))} disabled={isSekai} className="studio-pro-input">
                      {(isSekai ? [1] : [1, 2, 3, 4]).map((item) => <option key={item} value={item}>{item} image</option>)}
                    </select>
                  </label>
                </div>

                {isSekai && <div className="studio-pro-info"><span className="studio-pro-info-dot" />SEKAI Pixel menghasilkan satu gambar 1024×1024 dan belum mendukung reference image.</div>}

                {selected?.supportsReferenceImage && <label className="studio-pro-field">
                  <span className="studio-pro-label">Reference image</span>
                  <span className="studio-pro-upload">
                    <span>{reference ? reference.name : "Pilih JPG, PNG, atau WebP"}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReference(event.target.files?.[0] ?? null)} className="sr-only" />
                  </span>
                  <span className="mt-2 block text-xs text-slate-500">JPG, PNG, atau WebP · maksimal 10 MB</span>
                </label>}

                <div className="border-t border-white/10 pt-5">
                  <div className="mb-3 flex items-center justify-between text-sm"><span className="text-slate-400">Generation cost</span><span className="font-medium text-white">{cost} credit</span></div>
                  <button disabled={busy || topUpBusy || deletingId !== null || credits < cost} className="studio-pro-generate w-full"><StudioIcon />{busy ? "Generating..." : `Generate image · ${cost} credit`}</button>
                  {credits < cost && <p className="mt-3 text-center text-xs text-rose-300">Studio Credit tidak mencukupi.</p>}
                </div>
              </>}

              <div aria-live="polite">{message && <p role="status" className={message === "Generation selesai." || message === "Generation berhasil dihapus." ? "studio-pro-message studio-pro-message--success" : "studio-pro-message"}>{message}</p>}</div>
            </div>
          </form>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="studio-pro-panel overflow-hidden" aria-labelledby="workspace-heading">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
              <div><p className="studio-pro-eyebrow">Generator workspace</p><h2 id="workspace-heading" className="mt-1 text-lg font-medium tracking-[-.02em]">Latest creation</h2></div>
              <div className="flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />Private storage</div>
            </div>

            <div className="p-3 sm:p-5">
              <div className="studio-pro-canvas relative flex min-h-[360px] items-center justify-center overflow-hidden sm:min-h-[520px]">
                {latestWithOutput ? <>
                  <Image unoptimized src={`/api/studio/outputs/${latestWithOutput.outputs[0].id}`} alt="Karya AI terbaru" width={1024} height={1024} className="h-full max-h-[720px] w-full object-contain" priority />
                  <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-5 pt-20 sm:flex-row sm:items-end sm:justify-between sm:p-7">
                    <div className="min-w-0"><div className="flex items-center gap-2"><span className={statusClass(latestWithOutput.status)}>{latestWithOutput.status}</span><span className="text-xs text-slate-300">{latestWithOutput.provider} · {latestWithOutput.aspectRatio}</span></div><p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-white/85">{latestWithOutput.prompt}</p></div>
                    <a href={`/api/studio/outputs/${latestWithOutput.outputs[0].id}?download=1`} className="studio-pro-download shrink-0"><DownloadIcon />Download</a>
                  </div>
                </> : <div className="relative z-10 max-w-md px-6 text-center"><div className="studio-pro-empty-icon mx-auto"><ImageIcon /></div><h3 className="mt-5 text-xl font-medium tracking-[-.02em]">Your canvas is ready</h3><p className="mt-2 text-sm leading-6 text-slate-400">Tulis prompt di panel kontrol. Hasil terbaru akan tampil di area kerja ini.</p></div>}
              </div>
            </div>
          </section>

          <section aria-labelledby="history-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="studio-pro-eyebrow">Private gallery</p><h2 ref={historyHeadingRef} tabIndex={-1} id="history-heading" className="mt-1 text-2xl font-medium tracking-[-.03em] focus:outline-none">Generation history</h2></div>
              <button type="button" disabled={busy || topUpBusy || deletingId !== null} onClick={() => void refresh()} className="studio-pro-refresh"><RefreshIcon />Muat ulang</button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {history.map((item) => <article key={item.id} className="studio-pro-history-card group overflow-hidden">
                <div className={`relative grid aspect-square gap-1 bg-[#08090c] ${item.outputs.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {item.outputs.length > 0 ? item.outputs.map((output, outputIndex) => <div key={output.id} className={`relative min-h-0 overflow-hidden ${item.outputs.length === 3 && outputIndex === 0 ? "col-span-2" : ""}`}>
                    <Image unoptimized src={`/api/studio/outputs/${output.id}`} alt={`Hasil AI Studio ${outputIndex + 1}`} width={640} height={640} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
                    <a href={`/api/studio/outputs/${output.id}?download=1`} aria-label={`Unduh output ${outputIndex + 1}`} className="studio-pro-card-download"><DownloadIcon /></a>
                  </div>) : <div className="flex h-full items-center justify-center text-slate-700"><ImageIcon /></div>}
                  <div className="pointer-events-none absolute left-3 top-3"><span className={statusClass(item.status)}>{item.status}</span></div>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{item.provider} · {item.aspectRatio}</span><span>{item.creditCost} credit</span></div>
                  <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-200">{item.prompt}</p>
                  {item.errorMessage && <p className="mt-3 border-t border-rose-400/15 pt-3 text-xs leading-5 text-rose-300">{item.errorMessage}</p>}
                  {(item.status === "COMPLETED" || item.status === "FAILED") && <div className="mt-4 flex justify-end border-t border-white/10 pt-3">
                    <button type="button" disabled={deletingId !== null || busy || topUpBusy} onClick={() => void deleteGeneration(item)} aria-busy={deletingId === item.id} aria-label={deletingId === item.id ? "Sedang menghapus generation" : `Hapus generation ${item.status === "COMPLETED" ? "berhasil" : "gagal"}`} className="studio-pro-delete"><TrashIcon />{deletingId === item.id ? "Menghapus..." : "Hapus"}</button>
                  </div>}
                </div>
              </article>)}
              {!history.length && <div className="studio-pro-panel col-span-full px-6 py-16 text-center"><div className="studio-pro-empty-icon mx-auto"><ImageIcon /></div><p className="mt-4 text-sm text-slate-400">Belum ada generation. Karya pertama Anda akan muncul di sini.</p></div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  </main>;
}
