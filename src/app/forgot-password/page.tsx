"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

const GENERIC_MESSAGE = "Jika email tersebut terdaftar, kami akan mengirimkan instruksi berikutnya. Periksa inbox dan folder spam.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      setMessage(result.message ?? GENERIC_MESSAGE);
    } catch {
      setMessage(GENERIC_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  return <main className="grain flex min-h-[calc(100vh-4rem)] items-center px-4 py-10 sm:px-6 sm:py-16"><div className="mx-auto w-full max-w-md"><div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><div className="mb-8 flex justify-center"><BrandLogo /></div><p className="text-center text-xs font-bold uppercase tracking-[.2em] text-coral">Bantuan akun</p><h1 className="display mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">Lupa password?</h1><p className="mt-3 text-center text-sm leading-6 text-ink/60">Masukkan email akun Riezz99. Jika cocok, kami akan mengirim tautan untuk mengatur ulang password.</p><form onSubmit={submit} className="mt-8 space-y-5"><label htmlFor="forgot-email" className="block text-sm font-semibold text-ink">Email<input id="forgot-email" value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" required autoComplete="email" inputMode="email" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /></label><button type="submit" disabled={loading} className="h-12 w-full rounded-full bg-ink px-5 font-bold text-white transition hover:bg-coral disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Mengirim..." : "Kirim tautan reset"}</button></form>{message && <p role="status" className="mt-5 rounded-xl bg-mint px-4 py-3 text-sm leading-6 text-ink">{message}</p>}<Link href="/login" className="mt-6 block text-center text-sm font-semibold text-ink/60 hover:text-coral">Kembali ke masuk</Link></div><p className="mt-6 text-center text-xs text-ink/50">© {new Date().getFullYear()} Riezz99</p></div></main>;
}
