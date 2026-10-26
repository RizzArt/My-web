"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { PasswordInput } from "@/components/password-input";

declare global {
  interface Window {
    __riezz99ResetToken?: string;
  }
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bootstrapToken = window.__riezz99ResetToken;
    const fragmentToken = bootstrapToken ?? new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    delete window.__riezz99ResetToken;
    // Remove the bearer token before the user can navigate or copy the address.
    window.history.replaceState(null, "", window.location.pathname);
    if (fragmentToken) setToken(fragmentToken);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: form.get("newPassword"), passwordConfirmation: form.get("passwordConfirmation") }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) setError(result.error ?? "Tautan reset password tidak valid.");
      else router.push("/login?reset=success");
    } catch {
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="grain flex min-h-[calc(100vh-4rem)] items-center px-4 py-10 sm:px-6 sm:py-16"><div className="mx-auto w-full max-w-md"><div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-soft sm:p-9"><div className="mb-8 flex justify-center"><BrandLogo /></div><p className="text-center text-xs font-bold uppercase tracking-[.2em] text-coral">Keamanan akun</p><h1 className="display mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">Buat password baru</h1><p className="mt-3 text-center text-sm leading-6 text-ink/60">Gunakan password minimal 8 karakter. Tautan ini berlaku 30 menit dan hanya dapat digunakan sekali.</p><form onSubmit={submit} className="mt-8 space-y-5"><PasswordInput id="reset-password" name="newPassword" autoComplete="new-password" label="Password baru" /><PasswordInput id="reset-password-confirmation" name="passwordConfirmation" autoComplete="new-password" label="Konfirmasi password" />{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{error}</p>}<button type="submit" disabled={loading || !token} className="h-12 w-full rounded-full bg-ink px-5 font-bold text-white transition hover:bg-coral disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Menyimpan..." : "Simpan password baru"}</button></form><Link href="/login" className="mt-6 block text-center text-sm font-semibold text-ink/60 hover:text-coral">Kembali ke masuk</Link></div><p className="mt-6 text-center text-xs text-ink/50">© {new Date().getFullYear()} Riezz99</p></div></main>;
}
