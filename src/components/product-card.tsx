import Link from "next/link";
import type { Category, Product, SellerProfile } from "@prisma/client";
import { stockLabel, type ProductStock } from "@/lib/product-stock";
import { formatProductRating, type ProductRatingSummary } from "@/lib/product-rating";

type CardProduct = Pick<Product, "name" | "slug" | "price" | "shortDescription" | "thumbnailUrl" | "isFeatured"> & { category?: Pick<Category, "name"> | null; seller?: Pick<SellerProfile, "storeName" | "storeSlug"> | null; stockInfo?: ProductStock; ratingSummary?: ProductRatingSummary };

export function ProductCard({ product }: { product: CardProduct }) {
  const stock = product.stockInfo ?? { kind: "unlimited" as const, quantity: null, available: true };
  const soldOut = !stock.available;
  return <Link href={"/products/" + product.slug as never} className="group block min-w-0 rounded-2xl bg-white p-2.5 shadow-soft transition hover:-translate-y-0.5 hover:ring-2 hover:ring-coral/30 sm:p-3">
    <div className="relative aspect-[1.12/1] overflow-hidden rounded-xl bg-ink text-white">
      {product.thumbnailUrl ? <div className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-105" style={{ backgroundImage: "url(" + product.thumbnailUrl + ")" }} /> : <><div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-coral/80 transition duration-500 group-hover:scale-125" /><div className="absolute -bottom-10 -left-5 h-28 w-28 rounded-full bg-mint/80" /><div className="absolute inset-x-3 bottom-3"><span className="text-[9px] font-bold uppercase tracking-[.18em] text-white/65">Produk digital</span><p className="display mt-1 line-clamp-2 text-lg font-bold leading-tight">{product.name}</p></div></>}
      {product.isFeatured && <span className="absolute left-2.5 top-2.5 rounded-full bg-coral px-2 py-1 text-[10px] font-bold text-white shadow-sm">Unggulan</span>}
      {soldOut && <span className="absolute right-2.5 top-2.5 rounded-full bg-ink/85 px-2 py-1 text-[10px] font-bold text-white">Habis</span>}
    </div>
    <div className="px-0.5 pb-0.5 pt-2"><p className="truncate text-[11px] text-ink/55">{product.category?.name ?? "Produk digital"}</p><h3 className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-5 transition group-hover:text-coral sm:text-[15px]">{product.name}</h3>{product.ratingSummary?.average !== null && product.ratingSummary?.average !== undefined ? <p className="mt-1.5 flex items-center gap-1 text-[11px]" aria-label={`Rating ${formatProductRating(product.ratingSummary.average)} dari ${product.ratingSummary.count} ulasan`}><span aria-hidden="true" className="text-coral">★</span><span className="font-bold">{formatProductRating(product.ratingSummary.average)}</span><span className="text-ink/55">({product.ratingSummary.count.toLocaleString("id-ID")})</span></p> : <p className="mt-1.5 text-[11px] text-ink/55">Belum ada ulasan</p>}<div className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${soldOut ? "bg-red-50 text-red-700" : stock.quantity !== null && stock.quantity <= 5 ? "bg-coral/10 text-coral" : "bg-mint/60 text-ink"}`}>{stockLabel(stock)}</div><p className="mt-2 truncate text-[11px] text-ink/55">{product.seller?.storeName ?? "Toko"}</p><p className="mt-1.5 text-sm font-bold sm:text-base">Rp {product.price.toLocaleString("id-ID")}</p></div>
  </Link>;
}
