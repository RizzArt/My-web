"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { signIn as signInWithGoogle } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { PasswordInput } from "@/components/password-input";
import { safeInternalPath } from "@/lib/auth-redirect";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function continueWithGoogle() {
    if (loading) return;
    setLoading(true);
    await signInWithGoogle("google", { callbackUrl: safeInternalPath(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("callbackUrl")) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      if (form.get("password") !== form.get("passwordConfirmation")) {
        setError("Konfirmasi kata sandi tidak cocok.");
        return;
      }
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password"), passwordConfirmation: form.get("passwordConfirmation"), acceptedTerms: form.get("acceptedTerms") === "on" }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Terjadi kesalahan. Silakan coba lagi.");
        return;
      }
      sessionStorage.setItem("verificationEmail", String(form.get("email") ?? ""));
      router.push("/verify-email");
    } catch {
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-page grain flex min-h-[calc(100vh-4rem)] items-center px-4 py-10 sm:px-6 sm:py-16"><div className="mx-auto w-full max-w-md"><div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><div className="mb-8 flex justify-center"><BrandLogo /></div><p className="text-center text-xs font-bold uppercase tracking-[.2em] text-coral">Mulai bersama Riezz99</p><h1 className="display mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">Buat akun</h1><p className="mt-3 text-center text-sm leading-6 text-ink/60">Daftar untuk mulai belanja dan mengelola akun Anda.</p><button type="button" onClick={continueWithGoogle} disabled={loading} className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-ink/20 bg-white px-5 font-bold text-ink transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:opacity-60"><span aria-hidden="true" className="text-lg font-black text-[#4285f4]">G</span>Lanjutkan dengan Google</button><div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink/40"><span className="h-px flex-1 bg-ink/10" />atau<span className="h-px flex-1 bg-ink/10" /></div><form onSubmit={submit} className="space-y-5"><label htmlFor="register-name" className="block text-sm font-semibold text-ink">Nama<input id="register-name" name="name" type="text" required minLength={2} autoComplete="name" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /></label><label htmlFor="register-email" className="block text-sm font-semibold text-ink">Email<input id="register-email" name="email" type="email" required autoComplete="email" inputMode="email" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /></label><PasswordInput id="register-password" name="password" autoComplete="new-password" label="Kata sandi" /><PasswordInput id="register-password-confirmation" name="passwordConfirmation" autoComplete="new-password" label="Konfirmasi kata sandi" /><label className="flex items-start gap-3 text-sm leading-5 text-ink/70"><input name="acceptedTerms" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 accent-coral" /> <span>Saya menyetujui <Link href="/terms" className="font-semibold text-ink underline decoration-coral underline-offset-2">Syarat & Ketentuan</Link> dan <Link href="/privacy" className="font-semibold text-ink underline decoration-coral underline-offset-2">Kebijakan Privasi</Link></span></label>{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}<button type="submit" disabled={loading} className="h-12 w-full rounded-full bg-ink px-5 font-bold text-white transition hover:bg-coral disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Memproses..." : "Daftar"}</button></form><div className="mt-8 border-t border-ink/10 pt-6 text-center"><p className="text-sm text-ink/60">Sudah punya akun?</p><Link href="/login" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full border border-ink/20 font-bold transition hover:border-coral hover:text-coral">Masuk</Link></div><Link href="/" className="mt-6 block text-center text-sm font-semibold text-ink/60 hover:text-coral">Kembali ke toko</Link></div><p className="mt-6 text-center text-xs text-ink/50">© {new Date().getFullYear()} Riezz99</p></div></main>;
}
