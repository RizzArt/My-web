"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const gallery = Array.from(new Set(images));
  if (!gallery.length) return <div className="flex aspect-square items-center justify-center rounded-[1.75rem] bg-white p-8 text-center text-sm text-ink/60 shadow-soft">Gambar produk belum tersedia</div>;
  return <div>
    <div className="overflow-hidden rounded-[1.75rem] bg-white shadow-soft"><Image src={gallery[selected] ?? gallery[0]} alt={`${name}, gambar ${selected + 1}`} width={1000} height={1000} unoptimized priority className="aspect-square w-full object-cover" /></div>
    {gallery.length > 1 && <div className="mt-3 grid grid-cols-4 gap-3" aria-label="Pilih gambar produk">{gallery.map((src, index) => <button key={src} type="button" aria-label={`Lihat gambar ${index + 1} dari ${gallery.length}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`overflow-hidden rounded-xl border-2 bg-white p-0.5 ${selected === index ? "border-coral" : "border-transparent hover:border-ink/20"}`}><Image src={src} alt="" width={160} height={160} unoptimized className="aspect-square w-full rounded-lg object-cover" /></button>)}</div>}
  </div>;
}
