"use client";
import { displayLabel } from "@/lib/display-labels";

import { useRef, useState } from "react";

type Category = { id: string; name: string };
type Product = { id?: string; name?: string; shortDescription?: string | null; description?: string; price?: number; compareAtPrice?: number | null; categoryId?: string; thumbnailUrl?: string | null; type?: string; deliveryMode?: string; isPublished?: boolean; stock?: number | null; availableInventory?: number; galleryUrls?: unknown; rejectionReason?: string | null };
type MediaStatus = "empty" | "existing" | "queued" | "uploading" | "uploaded" | "error";
type GalleryItem = { id: string; url: string; file?: File; status: MediaStatus; progress: number; error?: string };

const imageAccept = "image/jpeg,image/png,image/webp";

function galleryValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
      : [];
}

function clientRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "server tidak merespons.";
}

export function ProductForm({ categories, product, seller }: { categories: Category[]; product?: Product; seller?: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [thumbnail, setThumbnail] = useState(product?.thumbnailUrl ?? "");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailStatus, setThumbnailStatus] = useState<MediaStatus>(product?.thumbnailUrl ? "existing" : "empty");
  const [thumbnailProgress, setThumbnailProgress] = useState(0);
  const [thumbnailError, setThumbnailError] = useState("");
  const [gallery, setGallery] = useState<GalleryItem[]>(() => galleryValue(product?.galleryUrls).map((url, index) => ({ id: `existing-${index}`, url, status: "existing", progress: 100 })));
  const createRequestId = useRef<string | null>(null);
  const value = (key: keyof Product) => product?.[key] as string | number | undefined;

  function upload(file: File, kind: "thumbnail" | "gallery", onProgress: (progress: number) => void) {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/products/upload");
      xhr.responseType = "json";
      xhr.timeout = 180_000;
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      });
      xhr.addEventListener("load", () => {
        let result: { url?: unknown; error?: string } = {};
        if (xhr.response && typeof xhr.response === "object") result = xhr.response as { url?: unknown; error?: string };
        else {
          try { result = JSON.parse(xhr.responseText || "{}") as { url?: unknown; error?: string }; } catch { /* proxy may return HTML for a rejected request */ }
        }
        if (xhr.status >= 200 && xhr.status < 300 && typeof result.url === "string") {
          onProgress(100);
          resolve(result.url);
          return;
        }
        if (xhr.status === 413) reject(new Error("File terlalu besar untuk server. Maksimal 5 MB per gambar."));
        else if (xhr.status === 408 || xhr.status === 504) reject(new Error("Upload timeout. Coba lagi dengan koneksi yang lebih stabil."));
        else reject(new Error(result.error ?? "Upload gambar gagal diproses."));
      });
      xhr.addEventListener("error", () => reject(new Error("Server upload tidak merespons. Coba lagi.")));
      xhr.addEventListener("timeout", () => reject(new Error("Upload timeout. Coba lagi dengan koneksi yang lebih stabil.")));
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      if (product?.id) body.append("productId", product.id);
      xhr.send(body);
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    let raw: Record<string, FormDataEntryValue>;
    try { raw = Object.fromEntries(new FormData(form)); } catch { setMessage("Gagal membaca data form. Silakan coba lagi."); return; }
    setBusy(true);
    setMessage("");
    try {
      let nextThumbnail = thumbnail;
      const nextGallery = gallery.map((item) => ({ ...item }));
      const filesToUpload = (thumbnailFile ? 1 : 0) + nextGallery.filter((item) => item.file).length;
      let uploaded = 0;
      const failed: string[] = [];

      if (thumbnailFile) {
        setThumbnailStatus("uploading");
        setThumbnailProgress(0);
        setUploadStatus(`Mengupload thumbnail ${uploaded + 1}/${filesToUpload} · 0%`);
        try {
          nextThumbnail = await upload(thumbnailFile, "thumbnail", (progress) => { setThumbnailProgress(progress); setUploadStatus(`Mengupload thumbnail ${uploaded + 1}/${filesToUpload} · ${progress}%`); });
          setThumbnail(nextThumbnail);
          setThumbnailFile(null);
          setThumbnailStatus("uploaded");
          setThumbnailError("");
        } catch (error) {
          const reason = errorText(error);
          setThumbnailStatus("error");
          setThumbnailError(reason);
          failed.push("thumbnail");
        }
        uploaded += 1;
      }

      for (let index = 0; index < nextGallery.length; index += 1) {
        const item = nextGallery[index];
        if (!item.file) continue;
        setGallery((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", progress: 0, error: undefined } : entry));
        setUploadStatus(`Mengupload gallery ${uploaded + 1}/${filesToUpload} · 0%`);
        try {
          const url = await upload(item.file, "gallery", (progress) => { setGallery((current) => current.map((entry) => entry.id === item.id ? { ...entry, progress } : entry)); setUploadStatus(`Mengupload gallery ${uploaded + 1}/${filesToUpload} · ${progress}%`); });
          nextGallery[index] = { ...item, url, file: undefined, status: "uploaded", progress: 100, error: undefined };
          setGallery([...nextGallery]);
        } catch (error) {
          const reason = errorText(error);
          nextGallery[index] = { ...item, status: "error", progress: 0, error: reason };
          setGallery([...nextGallery]);
          failed.push(`gallery-${index + 1}`);
        }
        uploaded += 1;
      }

      setUploadStatus("");
      if (failed.length) {
        setMessage(`Upload gagal untuk ${failed.length} gambar. Gambar yang berhasil tetap tersimpan di form; tekan Simpan produk untuk mengulang yang gagal.`);
        return;
      }

      const body = { ...raw, thumbnailUrl: nextThumbnail, galleryUrls: nextGallery.map((item) => item.url).join("\n"), isPublished: raw.isPublished === "on" };
      const endpoint = product?.id ? `/api/products/${product.id}` : seller ? "/api/seller/products" : "/api/admin/products";
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (!product?.id) {
        createRequestId.current ??= clientRequestId();
        headers["Idempotency-Key"] = createRequestId.current;
      }
      const response = await fetch(endpoint, { method: product?.id ? "PATCH" : "POST", headers, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Gagal menyimpan produk.");
      setMessage(product?.rejectionReason && seller ? "Produk berhasil disubmit ulang." : "Produk berhasil disimpan.");
      if (!product?.id) window.location.href = seller && result.product?.id && String(raw.deliveryMode) === "AUTO" && ["LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"].includes(String(raw.type)) ? `/seller/products/${result.product.id}/inventory` : seller ? "/seller/products" : "/admin/products";
      setThumbnail(nextThumbnail);
      setGallery(nextGallery);
      setThumbnailFile(null);
    } catch (error) {
      setUploadStatus("");
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const input = (name: string, label: string, type = "text", required = false) => <label className="grid gap-2 text-sm font-semibold">{label}<input name={name} type={type} required={required} defaultValue={value(name as keyof Product) ?? ""} className="rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal outline-none focus:border-coral" /></label>;
  const inventoryBacked = String(value("deliveryMode") ?? "AUTO") === "AUTO" && ["LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"].includes(String(value("type") ?? "FILE"));
  const statusLabel = (item: GalleryItem) => item.status === "existing" ? "Tersimpan" : item.status === "uploaded" ? "Upload berhasil" : item.status === "uploading" ? `Mengupload ${item.progress}%` : item.status === "error" ? "Upload gagal — ulangi dengan Simpan produk" : "Menunggu upload";

  return <form onSubmit={submit} className="grid gap-5 rounded-2xl bg-white p-5 pb-24 shadow-soft sm:p-7">
    {product?.rejectionReason && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800"><strong>Alasan penolakan:</strong> {product.rejectionReason}<br /><span className="text-xs">Perbaiki produk lalu tekan Submit Ulang.</span></div>}
    <section><h2 className="display text-2xl font-bold">Informasi Produk</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{input("name", "Nama produk", "text", true)}<label className="grid gap-2 text-sm font-semibold">Kategori<select name="categoryId" required defaultValue={value("categoryId") ?? ""} className="rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal"><option value="">Pilih kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><div className="sm:col-span-2">{input("shortDescription", "Deskripsi singkat")}</div><label className="grid gap-2 text-sm font-semibold sm:col-span-2">Deskripsi produk<textarea name="description" required defaultValue={value("description")} className="min-h-32 rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal outline-none" /></label></div></section>
    <section><h2 className="display text-2xl font-bold">Harga</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{input("price", "Harga", "number", true)}{input("compareAtPrice", "Harga promo (opsional)", "number")}</div></section>
    <section><h2 className="display text-2xl font-bold">Media</h2><div className="mt-4 grid gap-4"><div className="rounded-xl border border-ink/10 bg-sand/50 p-4"><p className="text-sm font-bold">Gambar utama</p>{thumbnail && <img src={thumbnail} alt="Preview thumbnail" className="mt-3 aspect-video max-h-52 w-full rounded-xl object-cover" />}<label className="mt-3 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-bold text-white">Unggah gambar utama<input type="file" accept={imageAccept} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setThumbnailFile(file); setThumbnail(URL.createObjectURL(file)); setThumbnailStatus("queued"); setThumbnailProgress(0); setThumbnailError(""); } }} /></label><p className="mt-2 text-xs text-ink/50">JPG, PNG, atau WEBP · maksimal 5 MB. HEIC/HEIF belum didukung server ini.</p>{thumbnailFile && <p className="mt-2 text-xs" aria-live="polite">{thumbnailStatus === "uploading" ? `Mengupload ${thumbnailProgress}%` : thumbnailStatus === "error" ? `Gagal: ${thumbnailError}` : thumbnailStatus === "uploaded" ? "Upload berhasil" : "Menunggu upload saat Simpan produk"}</p>}</div><div className="rounded-xl border border-ink/10 bg-sand/50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Galeri (maksimal 6)</p><label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-bold">Tambah gambar<input type="file" multiple accept={imageAccept} className="sr-only" onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 6 - gallery.length)); setGallery((current) => [...current, ...files.map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, url: URL.createObjectURL(file), file, status: "queued" as const, progress: 0 }))]); event.target.value = ""; }} /></label></div>{gallery.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{gallery.map((item, index) => <div key={item.id} className="relative rounded-xl border border-ink/10 p-2"><img src={item.url} alt={`Preview gallery ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" /><button type="button" aria-label="Hapus gambar gallery" onClick={() => setGallery((current) => current.filter((image) => image.id !== item.id))} className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-1 text-xs font-bold text-white">×</button><p className={`mt-2 text-xs ${item.status === "error" ? "text-red-700" : "text-ink/60"}`} aria-live="polite">{statusLabel(item)}</p>{item.error && <p role="alert" className="mt-1 break-words text-xs text-red-700">{item.error}</p>}</div>)}</div> : <p className="mt-3 text-sm text-ink/50">Belum ada gambar gallery.</p>}<p className="mt-3 text-xs text-ink/50">JPG, PNG, atau WEBP · maksimal 5 MB per gambar. HEIC/HEIF belum didukung server ini. File gagal dapat diulang tanpa menghapus gambar yang sudah berhasil.</p></div></div></section>
    <section><h2 className="display text-2xl font-bold">Pengiriman</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">Tipe produk<select name="type" defaultValue={value("type") ?? "FILE"} className="rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal">{["FILE", "LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"].map((type) => <option key={type} value={type}>{displayLabel(type)}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold">Metode pengiriman<select name="deliveryMode" defaultValue={value("deliveryMode") ?? "AUTO"} className="rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal"><option value="AUTO">Otomatis</option><option value="MANUAL">Manual</option></select></label></div><p className="mt-3 text-xs text-ink/55">Otomatis dikirim setelah pembayaran terverifikasi. Manual diproses oleh penjual/admin.</p></section>
    <section><h2 className="display text-2xl font-bold">Stok</h2><div className="mt-4">{inventoryBacked ? <div className="rounded-xl bg-mint/50 p-3 text-sm"><strong>Database stok digital</strong><p className="mt-1 text-ink/65">Stok AUTO dikelola melalui Database Stok setelah produk dibuat. {product?.availableInventory ?? 0} item tersedia.</p></div> : input("stock", "Stock / inventory", "number")}</div></section>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="isPublished" defaultChecked={product?.isPublished ?? !seller} /> Tampilkan produk</label>
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-ink/10 bg-white/95 p-3 backdrop-blur sm:static sm:p-0 sm:backdrop-blur-none"><button type="submit" disabled={busy} className="w-full rounded-full bg-ink px-5 py-3 font-bold text-white disabled:opacity-50 sm:w-auto">{busy ? (uploadStatus || "Menyimpan...") : product?.rejectionReason && seller ? "Submit Ulang" : "Simpan produk"}</button></div>{message && <p role="status" className="rounded-xl bg-mint p-4 text-sm">{message}</p>}
  </form>;
}
