"use client";

import { useState } from "react";

type ProbeResult = {
  trustedIdentityAccepted: boolean;
  identityFingerprint: string | null;
  forwardedForCleared: boolean;
  realIpRewrittenToLoopback: boolean;
  allowed?: boolean;
  retryAfterSeconds?: number | null;
  error?: string;
};

const forgedHeaders = {
  "X-Riezz-Trusted-Client-IP": "198.51.100.99",
  "X-Forwarded-For": "198.51.100.88",
  "X-Real-IP": "198.51.100.66",
};

async function readProbe(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({ error: "Respons diagnostik tidak valid." })) as ProbeResult;
  return { status: response.status, body, retryAfter: response.headers.get("Retry-After") };
}

export function StagingSecurityDiagnostics() {
  const [baseline, setBaseline] = useState<ProbeResult | null>(null);
  const [forged, setForged] = useState<ProbeResult | null>(null);
  const [rateResults, setRateResults] = useState<Array<{ status: number; retryAfter: string | null; body: ProbeResult }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runProxyProbe() {
    setBusy(true);
    setError("");
    try {
      const normal = await readProbe("/api/_staging/security/proxy-probe");
      const fake = await readProbe("/api/_staging/security/proxy-probe", { headers: forgedHeaders });
      if (normal.status !== 200 || fake.status !== 200) throw new Error(fake.body.error ?? normal.body.error ?? "Trusted header tidak diterima dari Cloudflare.");
      setBaseline(normal.body);
      setForged(fake.body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Probe gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function runRateLimitProbe() {
    setBusy(true);
    setError("");
    try {
      const results: Array<{ status: number; retryAfter: string | null; body: ProbeResult }> = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await readProbe("/api/_staging/security/rate-limit-probe", { method: "POST", headers: forgedHeaders });
        results.push(result);
      }
      setRateResults(results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Probe rate limit gagal.");
    } finally {
      setBusy(false);
    }
  }

  const headersPassed = baseline && forged
    && baseline.identityFingerprint === forged.identityFingerprint
    && forged.forwardedForCleared
    && forged.realIpRewrittenToLoopback;
  const ratePassed = rateResults.length === 6 && rateResults.slice(0, 5).every((result) => result.status === 200) && rateResults[5]?.status === 429;

  return <main className="grain min-h-screen px-4 py-10 sm:px-6"><section className="mx-auto max-w-2xl rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><p className="text-xs font-bold uppercase tracking-[.2em] text-coral">Staging only</p><h1 className="display mt-3 text-3xl font-bold tracking-tight">Proxy security diagnostics</h1><p className="mt-3 text-sm leading-6 text-ink/70">Halaman ini mengirim header palsu dari Safari, tetapi hanya menampilkan fingerprint IP. Tidak ada akun atau email dibuat.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><button type="button" disabled={busy} onClick={runProxyProbe} className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-60">1. Uji header palsu</button><button type="button" disabled={busy} onClick={runRateLimitProbe} className="rounded-full border border-ink/20 px-5 py-3 text-sm font-bold text-ink disabled:opacity-60">2. Uji rate limit (6 request)</button></div>{error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}<div className="mt-7 space-y-3 text-sm"><p>Header: {headersPassed ? <strong className="text-emerald-700">PASS</strong> : <span>belum diuji</span>}</p>{baseline && forged && <div className="rounded-xl bg-ink/5 p-4"><p>Fingerprint normal: <code>{baseline.identityFingerprint}</code></p><p>Fingerprint dengan header palsu: <code>{forged.identityFingerprint}</code></p><p>X-Forwarded-For dibersihkan: {String(forged.forwardedForCleared)}</p><p>X-Real-IP ditimpa loopback: {String(forged.realIpRewrittenToLoopback)}</p></div>}<p>Rate limit: {ratePassed ? <strong className="text-emerald-700">PASS (5x 200, lalu 429)</strong> : <span>belum diuji</span>}</p>{rateResults.length > 0 && <div className="rounded-xl bg-ink/5 p-4"><p>Status: {rateResults.map((result) => result.status).join(", ")}</p><p>Retry-After request ke-6: {rateResults[5]?.retryAfter ?? "-"}</p><p>Fingerprint: <code>{rateResults[0]?.body.identityFingerprint}</code></p></div>}</div><p className="mt-8 text-xs leading-5 text-ink/55">Jalankan masing-masing tombol sekali melalui Wi-Fi dan sekali melalui data seluler. Fingerprint antarjaringan harus berbeda; pada jaringan yang sama, header palsu harus menghasilkan fingerprint yang sama.</p></section></main>;
}
