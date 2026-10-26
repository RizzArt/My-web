"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return local && domain ? `${local[0]}***@${domain}` : "alamat email Anda";
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => setEmail(sessionStorage.getItem("verificationEmail") ?? ""), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !email) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Kode tidak valid atau sudah kedaluwarsa."); return; }
      sessionStorage.removeItem("verificationEmail");
      router.push("/login?verified=1");
    } catch { setError("Terjadi kesalahan. Silakan coba lagi."); } finally { setLoading(false); }
  }

  async function resend() {
    if (resending || !email) return;
    setResending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/verify-email", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Tidak dapat mengirim ulang kode."); return; }
      setMessage("Kode baru telah dikirim. Periksa inbox Anda.");
    } catch { setError("Terjadi kesalahan. Silakan coba lagi."); } finally { setResending(false); }
  }

  return <main className="grain flex min-h-[calc(100vh-4rem)] items-center px-4 py-10 sm:px-6 sm:py-16"><div className="mx-auto w-full max-w-md"><div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><div className="mb-8 flex justify-center"><BrandLogo /></div><p className="text-center text-xs font-bold uppercase tracking-[.2em] text-coral">Satu langkah lagi</p><h1 className="display mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">Verifikasi Email</h1><p className="mt-4 text-center text-sm leading-6 text-ink/60">Kami telah mengirim kode 6 digit ke {email ? <strong className="text-ink">{maskEmail(email)}</strong> : "alamat email Anda"}.</p><form onSubmit={submit} className="mt-8 space-y-5">{!email && <label className="block text-sm font-semibold text-ink">Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 outline-none focus:border-coral focus:ring-2 focus:ring-coral/20" /></label>}<label htmlFor="verification-code" className="block text-sm font-semibold text-ink">Kode verifikasi<input id="verification-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="mt-2 h-14 w-full rounded-xl border border-ink/15 bg-white px-4 text-center text-2xl font-bold tracking-[.65em] outline-none focus:border-coral focus:ring-2 focus:ring-coral/20" /></label>{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-xl bg-mint px-4 py-3 text-sm text-ink">{message}</p>}<button type="submit" disabled={loading || code.length !== 6} className="h-12 w-full rounded-full bg-ink px-5 font-bold text-white transition hover:bg-coral disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Memverifikasi..." : "Verifikasi"}</button></form><button type="button" onClick={resend} disabled={resending || !email} className="mt-5 w-full text-sm font-bold text-coral hover:underline disabled:opacity-50">{resending ? "Mengirim..." : "Kirim ulang kode"}</button><Link href="/login" className="mt-6 block text-center text-sm font-semibold text-ink/60 hover:text-coral">Kembali ke masuk</Link></div><p className="mt-6 text-center text-xs text-ink/50">© {new Date().getFullYear()} Riezz99</p></div></main>;
}
