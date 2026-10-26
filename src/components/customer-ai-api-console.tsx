"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Key = { id: string; name: string; prefix: string; status: "ACTIVE" | "REVOKED"; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; rateLimitPerMinute: number; concurrencyLimit: number; dailySpendLimitMicros: string };
type Ledger = { id: string; kind: string; availableDeltaMicros: string; reservedDeltaMicros: string; availableAfterMicros: string; reservedAfterMicros: string; safeReasonCode: string | null; createdAt: string };
type Daily = { usageDate: string; spentMicros: string; reservedMicros: string; admittedRequestCount: string };
type Overview = { wallet: { availableMicros: string; reservedMicros: string; dailySpendLimitMicros: string; isFrozen: boolean; frozenReason: string | null } | null; keys: Key[]; ledger: Ledger[]; daily: Daily; dailyHistory: Daily[] };

const microsPerRupiah = BigInt(1_000_000);
const newIdempotency = () => crypto.randomUUID();
function rupiah(micros: string) {
  const value = BigInt(micros);
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  const whole = absolute / microsPerRupiah;
  const fraction = (absolute % microsPerRupiah).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}Rp ${whole.toLocaleString("id-ID")}${fraction ? `,${fraction}` : ""}`;
}
function date(value: string | null) { return value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Tidak dibatasi"; }
function badge(status: string) { return status === "ACTIVE" ? "api-pro-status api-pro-status--ready" : "api-pro-status api-pro-status--muted"; }

export function CustomerAiApiConsole() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("Postman development");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const activeKeys = useMemo(() => data?.keys.filter((key) => key.status === "ACTIVE").length ?? 0, [data]);
  async function load() {
    const response = await fetch("/api/account/ai-api/overview", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "API Balance tidak dapat dimuat.");
    setData(body);
  }
  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, []);

  async function issueKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setPlaintextKey(null);
    const storageKey = "riezz99-ai-api-key-issuance-idempotency";
    const idempotencyKey = sessionStorage.getItem(storageKey) ?? newIdempotency();
    sessionStorage.setItem(storageKey, idempotencyKey);
    try {
      const response = await fetch("/api/account/ai-api/keys", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ name: keyName, expiresInDays: Number(expiresInDays) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if ([400, 401, 403, 409].includes(response.status)) sessionStorage.removeItem(storageKey);
        throw new Error(body?.error ?? "API key tidak dapat dibuat.");
      }
      sessionStorage.removeItem(storageKey);
      setPlaintextKey(body.key.plaintext);
      setMessage("API key dibuat. Simpan sekarang; nilai ini tidak dapat ditampilkan kembali.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "API key gagal dibuat."); }
    finally { setBusy(false); }
  }
  async function revokeKey(event: FormEvent) {
    event.preventDefault();
    if (!revokeId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/account/ai-api/keys/${revokeId}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: revokeReason }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "API key tidak dapat dicabut.");
      setRevokeId(null); setRevokeReason(""); setMessage("API key telah dicabut."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "API key gagal dicabut."); }
    finally { setBusy(false); }
  }
  async function copyKey() {
    if (!plaintextKey) return;
    try { await navigator.clipboard.writeText(plaintextKey); setMessage("API key tersalin ke clipboard. Jangan kirim ke siapa pun."); }
    catch { setMessage("Clipboard tidak tersedia. Salin key secara manual sebelum menutup halaman."); }
  }

  return <div className="mx-auto max-w-6xl">
    <header className="api-pro-hero"><div><p className="api-pro-eyebrow">Riezz99 Developer Console</p><h1 className="api-pro-title">API Balance <span>&amp;</span> Keys</h1><p className="api-pro-lead">Kelola kredensial dan saldo API terpisah dari saldo marketplace maupun Studio Credit.</p></div><a className="api-pro-doc-link" href="#quickstart">OpenAI-compatible quickstart <span>↗</span></a></header>
    {message && <div role="status" className="api-pro-message">{message}</div>}
    {plaintextKey && <section className="api-pro-secret" aria-live="polite"><div><p className="api-pro-eyebrow">One-time secret reveal</p><strong>Salin API key Anda sekarang.</strong><code>{plaintextKey}</code><p>Key ini tidak disimpan di browser dan tidak akan ditampilkan ulang.</p></div><button type="button" onClick={copyKey} className="api-pro-primary">Salin key</button></section>}
    <section id="balance" className="mt-8 grid gap-4 lg:grid-cols-4">
      <article className="api-pro-metric api-pro-metric--primary"><span>Available balance</span><strong>{data?.wallet ? rupiah(data.wallet.availableMicros) : "Rp 0"}</strong><small>Siap untuk reservasi request</small></article>
      <article className="api-pro-metric"><span>Reserved</span><strong>{data?.wallet ? rupiah(data.wallet.reservedMicros) : "Rp 0"}</strong><small>Menunggu hasil provider</small></article>
      <article className="api-pro-metric"><span>Spending hari ini</span><strong>{data ? rupiah(data.daily.spentMicros) : "Rp 0"}</strong><small>{data?.daily.admittedRequestCount ?? 0} request diterima</small></article>
      <article className="api-pro-metric"><span>Active keys</span><strong>{activeKeys}/5</strong><small>{data?.wallet?.isFrozen ? "Wallet dibekukan" : "Limit dan saldo dikelola server"}</small></article>
    </section>
    {!data?.wallet && <section className="api-pro-panel mt-6"><h2>API Balance belum tersedia</h2><p>Mintalah admin menambahkan API Balance sebelum request dapat dikirim. Top-up mandiri belum dibuka agar saldo dan ledger tetap terkontrol.</p></section>}
    <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <section id="keys" className="api-pro-panel"><div className="api-pro-section-heading"><div><p className="api-pro-eyebrow">Credentials</p><h2>API Keys</h2></div><span>{activeKeys} aktif</span></div><form className="api-pro-form" onSubmit={issueKey}><label>Nama key<input className="api-pro-input" value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={100} required /></label><label>Masa berlaku<select className="api-pro-input" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}><option value="7">7 hari</option><option value="30">30 hari</option><option value="90">90 hari</option></select></label><button className="api-pro-primary" disabled={busy || activeKeys >= 5}>{busy ? "Memproses…" : "Buat API key"}</button></form><div className="api-pro-key-list">{data?.keys.map((key) => <article key={key.id} className="api-pro-key"><div><div className="flex flex-wrap items-center gap-2"><strong>{key.name}</strong><span className={badge(key.status)}>{key.status}</span></div><code>{key.prefix}••••••••</code><p>Dibuat {date(key.createdAt)} · Berakhir {date(key.expiresAt)} · Dipakai {date(key.lastUsedAt)}</p><p>{key.rateLimitPerMinute}/menit · concurrency {key.concurrencyLimit} · limit {rupiah(key.dailySpendLimitMicros)}/hari</p></div>{key.status === "ACTIVE" && <button className="api-pro-danger" type="button" onClick={() => { setRevokeId(key.id); setRevokeReason(""); }}>Cabut</button>}</article>)}{!data?.keys.length && <p className="api-pro-empty">Belum ada API key. Key hanya terlihat satu kali setelah diterbitkan.</p>}</div>{revokeId && <form className="api-pro-revoke" onSubmit={revokeKey}><label>Alasan pencabutan<input className="api-pro-input" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} minLength={3} maxLength={300} placeholder="Contoh: perangkat tidak lagi digunakan" required /></label><div><button className="api-pro-danger" disabled={busy}>Konfirmasi cabut</button><button className="api-pro-secondary" type="button" onClick={() => setRevokeId(null)}>Batal</button></div></form>}</section>
      <section className="api-pro-panel"><div className="api-pro-section-heading"><div><p className="api-pro-eyebrow">Usage trail</p><h2>Riwayat API Balance</h2></div><span>30 hari</span></div><div className="api-pro-ledger">{data?.ledger.map((entry) => <article key={entry.id}><div><strong>{entry.kind}</strong><p>{entry.safeReasonCode ?? "Server-side API event"}</p><small>{date(entry.createdAt)}</small></div><div className="text-right"><strong className={BigInt(entry.availableDeltaMicros) >= BigInt(0) ? "text-lime-200" : "text-rose-300"}>{BigInt(entry.availableDeltaMicros) >= BigInt(0) ? "+" : ""}{rupiah(entry.availableDeltaMicros)}</strong><small>After {rupiah(entry.availableAfterMicros)}</small></div></article>)}{!data?.ledger.length && <p className="api-pro-empty">Belum ada aktivitas ledger.</p>}</div><div className="api-pro-daily-list">{data?.dailyHistory.map((row) => <div key={row.usageDate}><span>{new Date(row.usageDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span><span>{rupiah(row.spentMicros)} spent · {row.admittedRequestCount} request</span></div>)}{!data?.dailyHistory.length && <p className="api-pro-empty">Belum ada pemakaian harian.</p>}</div></section>
    </div>
    <section id="quickstart" className="api-pro-panel mt-6"><div className="api-pro-section-heading"><div><p className="api-pro-eyebrow">Quickstart</p><h2>Codex / Responses API / Chat Completions</h2></div><span>OpenAI-compatible</span></div><p>Gunakan environment variable untuk key. Jangan simpan secret di <code>config.toml</code>, source code, screenshot, atau chat.</p><h3 className="mt-5 font-semibold text-white">Temukan model yang diizinkan</h3><pre className="api-pro-code">{`GET https://api.riezz99.biz.id/v1/models
Authorization: Bearer $RIEZZ99_API_KEY`}</pre><p>Gunakan ID teknis persis dari <code>data[].id</code> pada hasil discovery yang berhasil untuk mengganti <code>MODEL_ID_DARI_DAFTAR_MODELS</code> di semua contoh berikut. Placeholder bukan model siap pakai. Daftar kosong atau gagal dimuat berarti tidak ada model yang dapat digunakan; jangan kirim request Responses atau Chat Completions sampai model tersedia dan diizinkan oleh server. Jangan menebak ID atau mengganti ID teknis dengan nama tampilan.</p><h3 className="mt-5 font-semibold text-white">Codex CLI</h3><pre className="api-pro-code">{`read -rsp "Riezz99 API key: " RIEZZ99_API_KEY; echo\nexport RIEZZ99_API_KEY\n\nmodel = "MODEL_ID_DARI_DAFTAR_MODELS"\nmodel_provider = "riezz99"\nweb_search = "disabled"\n\n[model_providers.riezz99]\nname = "Riezz99 AI API"\nbase_url = "https://api.riezz99.biz.id/v1"\nenv_key = "RIEZZ99_API_KEY"\nwire_api = "responses"`}</pre><h3 className="mt-5 font-semibold text-white">Responses API</h3><pre className="api-pro-code">{`POST https://api.riezz99.biz.id/v1/responses\nAuthorization: Bearer $RIEZZ99_API_KEY\nIdempotency-Key: UUID-baru\nContent-Type: application/json\n\n{\n  "model": "MODEL_ID_DARI_DAFTAR_MODELS",\n  "input": "Halo",\n  "stream": false\n}`}</pre><h3 className="mt-5 font-semibold text-white">Chat Completions</h3><pre className="api-pro-code">{`POST https://api.riezz99.biz.id/v1/chat/completions\nAuthorization: Bearer $RIEZZ99_API_KEY\nIdempotency-Key: UUID-baru\nContent-Type: application/json\n\n{\n  "model": "MODEL_ID_DARI_DAFTAR_MODELS",\n  "messages": [{"role":"user","content":"Halo"}],\n  "max_tokens": 150\n}`}</pre></section>
  </div>;
}
