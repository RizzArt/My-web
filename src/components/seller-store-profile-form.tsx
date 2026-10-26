"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SellerProfile = { storeName: string; storeSlug: string; description: string; logoUrl: string | null; bannerUrl: string | null };

export function SellerStoreProfileForm({ seller }: { seller: SellerProfile }) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(seller.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(seller.bannerUrl ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(file: File, kind: "logo" | "banner") {
    const body = new FormData(); body.set("file", file); body.set("kind", kind);
    const response = await fetch("/api/products/upload", { method: "POST", body }); const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Upload gagal.");
    if (kind === "logo") setLogoUrl(result.url); else setBannerUrl(result.url);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/seller/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, logoUrl: logoUrl || null, bannerUrl: bannerUrl || null }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Profil gagal disimpan.");
      setMessage("Profil toko tersimpan."); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Profil gagal disimpan."); } finally { setBusy(false); }
  }
  async function pick(event: React.ChangeEvent<HTMLInputElement>, kind: "logo" | "banner") { const file = event.target.files?.[0]; if (!file) return; setError(""); try { await upload(file, kind); } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload gagal."); } }
  return <form onSubmit={submit} className="mt-8 rounded-2xl bg-white p-6 shadow-soft sm:p-8"><h2 className="display text-2xl font-bold">Profil Toko</h2><div className="mt-5 grid gap-4"><label className="text-sm font-semibold">Nama Toko<input name="storeName" required defaultValue={seller.storeName} className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><label className="text-sm font-semibold">Deskripsi Toko<textarea name="description" rows={5} defaultValue={seller.description} className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><label className="text-sm font-semibold">Logo Toko<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => pick(event, "logo")} className="mt-2 block w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><label className="text-sm font-semibold">Banner Toko<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => pick(event, "banner")} className="mt-2 block w-full rounded-xl border border-ink/15 px-4 py-3 font-normal" /></label><p className="text-xs text-ink/55">JPG, PNG, atau WEBP maksimal 5 MB. Gambar otomatis dikonversi ke WEBP.</p></div><div className="mt-5 rounded-xl bg-sand p-4 text-sm"><p className="font-semibold">URL toko</p><p className="mt-1 break-all text-ink/65">riezz99.biz.id/store/{seller.storeSlug}</p></div><button disabled={busy} className="mt-6 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Menyimpan..." : "Simpan Profil Toko"}</button>{(message || error) && <p role="status" className={`mt-4 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-mint"}`}>{error || message}</p>}</form>;
}
