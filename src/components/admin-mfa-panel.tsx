"use client";

/* eslint-disable @next/next/no-img-element -- Authenticator QR is an in-memory data URL. */

import { FormEvent, useState } from "react";
import { adminMfaEnrollmentPayload } from "@/lib/admin-mfa-enrollment-input";

type Enrollment = { manualKey: string; qrCodeDataUrl: string; expiresAt: string };
type RecoveryResponse = { recoveryCodes: string[]; signInRequired?: boolean };

async function jsonRequest(path: string, body?: object) {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
  const payload = await response.json().catch(() => ({})) as { error?: string } & Partial<Enrollment & RecoveryResponse>;
  if (!response.ok) throw new Error(payload.error ?? "Permintaan keamanan gagal.");
  return payload;
}

export function AdminMfaPanel({ enabled }: { enabled: boolean }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const data = await jsonRequest("/api/admin/mfa/enroll", adminMfaEnrollmentPayload(form)) as Enrollment;
      setEnrollment(data);
      setStepUp(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enrollment MFA gagal dimulai.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const code = String(new FormData(event.currentTarget).get("code") ?? "");
      const data = await jsonRequest("/api/admin/mfa/enroll/verify", { code }) as RecoveryResponse;
      setRecoveryCodes(data.recoveryCodes ?? []);
      setEnrollment(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kode autentikator tidak dapat diverifikasi.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecoveryCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const code = String(new FormData(event.currentTarget).get("code") ?? "");
      const data = await jsonRequest("/api/admin/mfa/recovery-codes", { code }) as RecoveryResponse;
      setRecoveryCodes(data.recoveryCodes ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recovery code tidak dapat dibuat ulang.");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes.length) {
    return <section className="mt-8 rounded-2xl border border-coral/30 bg-coral/5 p-5 sm:p-7"><h2 className="display text-2xl font-bold">Simpan recovery code sekarang</h2><p className="mt-3 text-sm leading-6 text-ink/70">Setiap kode hanya dapat dipakai sekali. Kode ini tidak akan ditampilkan lagi setelah halaman ditutup.</p><ul className="mt-5 grid gap-2 rounded-xl bg-white p-4 font-mono text-sm sm:grid-cols-2">{recoveryCodes.map((code) => <li key={code}>{code}</li>)}</ul><button type="button" onClick={() => { window.location.href = "/login?mfa=enrolled"; }} className="mt-5 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white">Saya sudah menyimpan kode, masuk kembali</button></section>;
  }

  return <section className="mt-8 rounded-2xl bg-white p-5 shadow-soft sm:p-7"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Keamanan admin</p><h2 className="display mt-3 text-3xl font-bold">Autentikator dua langkah</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/65">{enabled ? "MFA aktif. Gunakan kode enam digit saat masuk dengan password." : "MFA belum aktif. Aktivasi baru berlaku setelah kode aplikasi autentikator berhasil diverifikasi."}</p>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}{enrollment ? <div className="mt-6 rounded-xl border border-ink/10 p-5"><h3 className="font-bold">1. Tambahkan ke aplikasi autentikator</h3><img src={enrollment.qrCodeDataUrl} alt="QR code untuk aplikasi autentikator" width={240} height={240} className="mt-4 rounded-lg border border-ink/10" /><p className="mt-4 text-sm text-ink/60">Atau masukkan kunci ini secara manual:</p><code className="mt-2 block break-all rounded-lg bg-sand p-3 text-sm">{enrollment.manualKey}</code><form onSubmit={verifyEnrollment} className="mt-5 space-y-3"><label className="block text-sm font-semibold">2. Masukkan kode enam digit<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" className="mt-2 h-11 w-full rounded-xl border border-ink/15 px-4 font-mono tracking-[0.2em]" /></label><button disabled={busy} className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Memverifikasi..." : "Aktifkan MFA"}</button></form></div> : <>{stepUp ? <form onSubmit={beginEnrollment} className="mt-6 space-y-4 rounded-xl border border-ink/10 p-5"><h3 className="font-bold">Konfirmasi keamanan</h3><p className="text-sm leading-6 text-ink/60">Masukkan password lokal sebelum menampilkan secret enrollment.{enabled ? " Karena MFA sudah aktif, masukkan juga kode autentikator atau recovery code yang belum dipakai." : ""}</p><label className="block text-sm font-semibold">Password lokal<input name="password" type="password" required autoComplete="current-password" className="mt-2 h-11 w-full rounded-xl border border-ink/15 px-4" /></label>{enabled && <label className="block text-sm font-semibold">Kode autentikator atau recovery code<input name="mfaCode" type="text" required autoComplete="one-time-code" className="mt-2 h-11 w-full rounded-xl border border-ink/15 px-4 font-mono" /></label>}<div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Memverifikasi..." : "Lanjutkan"}</button><button type="button" onClick={() => setStepUp(false)} disabled={busy} className="rounded-full border border-ink/20 px-5 py-3 text-sm font-bold disabled:opacity-60">Batal</button></div></form> : <button type="button" onClick={() => setStepUp(true)} disabled={busy} className="mt-6 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{enabled ? "Ganti aplikasi autentikator" : "Mulai enrollment MFA"}</button>}{enabled && <form onSubmit={regenerateRecoveryCodes} className="mt-8 border-t border-ink/10 pt-6"><h3 className="font-bold">Buat ulang recovery code</h3><p className="mt-2 text-sm text-ink/60">Masukkan kode aplikasi autentikator. Kode recovery lama akan dicabut setelah kode baru dibuat.</p><label className="mt-4 block text-sm font-semibold">Kode enam digit<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" className="mt-2 h-11 w-full rounded-xl border border-ink/15 px-4 font-mono tracking-[0.2em]" /></label><button disabled={busy} className="mt-4 rounded-full border border-ink/20 px-5 py-3 text-sm font-bold disabled:opacity-60">Buat recovery code baru</button></form>}<p className="mt-8 border-t border-ink/10 pt-5 text-sm leading-6 text-ink/60">Kehilangan perangkat? Gunakan satu recovery code untuk masuk, lalu daftarkan perangkat baru. Jika semua recovery code hilang, ikuti prosedur pemulihan offline yang memerlukan verifikasi identitas dan audit dua petugas; tidak ada bypass melalui email atau chat.</p></>}</section>;
}
