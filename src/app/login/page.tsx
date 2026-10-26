"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { PasswordInput } from "@/components/password-input";
import { safeInternalPath } from "@/lib/auth-redirect";

function callbackUrl() {
  if (typeof window === "undefined") return "/auth/redirect";
  return safeInternalPath(new URLSearchParams(window.location.search).get("callbackUrl"));
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [resultCode, setResultCode] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error") ?? "";
    setResultCode(code);
    setResetSuccess(new URLSearchParams(window.location.search).get("reset") === "success");
    if (code === "google-email-exists") setError("Email ini sudah memiliki akun password. Masuk dengan email/password. Penautan Google tidak dilakukan otomatis; hubungi dukungan Riezz99 jika akun perlu ditautkan.");
    else if (code === "google-email-unverified") setError("Email Google belum terverifikasi. Gunakan akun Google dengan email yang sudah terverifikasi.");
    else if (code === "admin-mfa-password-required") setError("Admin dengan MFA aktif harus masuk memakai email, password, dan kode autentikator.");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await signIn("credentials", { email: form.get("email"), password: form.get("password"), mfaCode: form.get("mfaCode"), redirect: false, callbackUrl: callbackUrl() });
      setResultCode(result?.code ?? "");
      if (result?.code === "email-not-verified") setError("Email belum diverifikasi.");
      else if (result?.code === "mfa-required") setError("Masukkan kode enam digit dari aplikasi autentikator.");
      else if (result?.code === "mfa-invalid") setError("Kode autentikator atau recovery code tidak valid.");
      else if (result?.error) setError("Email atau kata sandi tidak valid.");
      else router.push(callbackUrl() as never);
    } catch {
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  async function continueWithGoogle() {
    if (loading) return;
    setLoading(true);
    await signIn("google", { callbackUrl: callbackUrl() });
  }

  return <main className="auth-page grain flex min-h-[calc(100vh-4rem)] items-center px-4 py-10 sm:px-6 sm:py-16"><div className="mx-auto w-full max-w-md"><div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><div className="mb-8 flex justify-center"><BrandLogo /></div><p className="text-center text-xs font-bold uppercase tracking-[.2em] text-coral">Akun Anda</p><h1 className="display mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">Masuk ke Riezz99</h1><p className="mx-auto mt-3 max-w-sm text-center text-sm leading-6 text-ink/60">Masuk untuk melanjutkan belanja dan mengelola akun Anda.</p><button type="button" onClick={continueWithGoogle} disabled={loading} className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-ink/20 bg-white px-5 font-bold text-ink transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:opacity-60"><span aria-hidden="true" className="text-lg font-black text-[#4285f4]">G</span>Lanjutkan dengan Google</button><div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink/40"><span className="h-px flex-1 bg-ink/10" />atau<span className="h-px flex-1 bg-ink/10" /></div><form onSubmit={submit} className="space-y-5"><label htmlFor="login-email" className="block text-sm font-semibold text-ink">Email<input id="login-email" name="email" type="email" required autoComplete="email" inputMode="email" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /></label><PasswordInput id="login-password" name="password" autoComplete="current-password" label="Kata sandi" /><label htmlFor="login-mfa-code" className="block text-sm font-semibold text-ink">Kode autentikator atau recovery code <span className="font-normal text-ink/55">(khusus admin yang sudah mengaktifkan MFA)</span><input id="login-mfa-code" name="mfaCode" type="text" inputMode="numeric" autoComplete="one-time-code" className="mt-2 h-12 w-full rounded-xl border border-ink/15 bg-white px-4 font-mono tracking-[0.2em] outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20" /></label><div className="-mt-2 text-right"><Link href={"/forgot-password" as never} className="text-sm font-semibold text-coral hover:underline">Lupa kata sandi?</Link></div>{error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"><p>{error}</p>{resultCode === "email-not-verified" && <Link href="/verify-email" className="mt-2 inline-block font-bold underline">Kirim ulang kode verifikasi</Link>}</div>}{resetSuccess && <p role="status" className="rounded-xl bg-mint px-4 py-3 text-sm text-ink">Kata sandi berhasil diubah. Silakan masuk kembali.</p>}<button type="submit" disabled={loading} className="h-12 w-full rounded-full bg-ink px-5 font-bold text-white transition hover:bg-coral disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Memproses..." : "Masuk"}</button></form><div className="mt-8 border-t border-ink/10 pt-6 text-center"><p className="text-sm text-ink/60">Belum punya akun?</p><Link href="/register" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full border border-ink/20 font-bold transition hover:border-coral hover:text-coral">Daftar</Link></div><Link href="/" className="mt-6 block text-center text-sm font-semibold text-ink/60 hover:text-coral">Kembali ke toko</Link></div><p className="mt-6 text-center text-xs text-ink/50">© {new Date().getFullYear()} Riezz99</p></div></main>;
}
