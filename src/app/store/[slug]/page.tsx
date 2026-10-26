import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { StoreChatButton } from "@/components/store-chat-button";
import { prisma } from "@/lib/prisma";
import { productVisibilityWhere } from "@/lib/seller";
import { attachStock } from "@/lib/product-stock";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 24;
type Params = { slug: string };
type Search = { q?: string; category?: string; sort?: string; page?: string };

async function getStore(slug: string) {
  return prisma.sellerProfile.findFirst({ where: { storeSlug: slug, isActive: true, user: { isActive: true, role: "SELLER" } }, select: { id: true, storeName: true, storeSlug: true, description: true, logoUrl: true, bannerUrl: true, isVerified: true } });
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params; const seller = await getStore(slug); if (!seller) return { title: "Toko tidak ditemukan" };
  const description = seller.description || `Koleksi produk digital dari ${seller.storeName}.`;
  return { title: seller.storeName, description, alternates: { canonical: `${SITE_URL}/store/${seller.storeSlug}` }, openGraph: { title: `${seller.storeName} | Riezz99`, description, url: `${SITE_URL}/store/${seller.storeSlug}`, images: seller.bannerUrl || seller.logoUrl ? [seller.bannerUrl || seller.logoUrl!] : undefined } };
}

export default async function StorePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { slug } = await params; const query = await searchParams; const seller = await getStore(slug); if (!seller) notFound();
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1); const search = query.q?.trim();
  const where = { sellerId: seller.id, ...productVisibilityWhere(), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { shortDescription: { contains: search, mode: "insensitive" as const } }] } : {}), ...(query.category ? { category: { slug: query.category, isActive: true } } : {}) };
  const productsPromise = query.sort === "rating"
    ? Promise.all([
      prisma.product.findMany({ where, include: { category: true, seller: { select: { storeName: true, storeSlug: true } } } }),
      prisma.productReview.groupBy({ by: ["productId"], where: { product: { sellerId: seller.id } }, _avg: { rating: true } }),
    ]).then(([allProducts, ratings]) => {
      const averageByProduct = new Map(ratings.map((rating) => [rating.productId, rating._avg.rating ?? 0]));
      return allProducts
        .sort((a, b) => (averageByProduct.get(b.id) ?? 0) - (averageByProduct.get(a.id) ?? 0) || b.createdAt.getTime() - a.createdAt.getTime())
        .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    })
    : prisma.product.findMany({ where, include: { category: true, seller: { select: { storeName: true, storeSlug: true } } }, orderBy: query.sort === "price-asc" ? { price: "asc" } : query.sort === "price-desc" ? { price: "desc" } : { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const [products, total, reviews, categories] = await Promise.all([
    productsPromise,
    prisma.product.count({ where }),
    prisma.productReview.aggregate({ where: { product: { sellerId: seller.id } }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.category.findMany({ where: { isActive: true, products: { some: { sellerId: seller.id, ...productVisibilityWhere() } } }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
  ]);
  const productsWithStock = await attachStock(products); const totalPages = Math.ceil(total / PAGE_SIZE);
  const paramsFor = (overrides: Record<string, string>) => { const next = new URLSearchParams(); if (search) next.set("q", search); if (query.category) next.set("category", query.category); if (query.sort) next.set("sort", query.sort); Object.entries(overrides).forEach(([key, value]) => next.set(key, value)); return `?${next}`; };
  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-12"><section className="relative overflow-hidden rounded-[1.75rem] bg-ink text-white"><div className="h-40 bg-gradient-to-br from-coral/80 via-ink to-mint/40 bg-cover bg-center sm:h-56" style={seller.bannerUrl ? { backgroundImage: `linear-gradient(90deg, rgba(17,24,39,.3), rgba(17,24,39,.55)), url(${seller.bannerUrl})` } : undefined} /><div className="relative -mt-12 px-5 pb-6 sm:-mt-16 sm:px-10 sm:pb-10"><div className="flex flex-wrap items-end justify-between gap-5"><div className="flex min-w-0 items-end gap-4"><div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-ink bg-sand text-2xl font-bold text-ink sm:h-32 sm:w-32">{seller.logoUrl ? <img src={seller.logoUrl} alt={`Logo ${seller.storeName}`} className="h-full w-full object-cover" /> : <span>R</span>}</div><div className="min-w-0 pb-1"><h1 className="display truncate text-3xl font-bold sm:text-5xl">{seller.storeName}</h1><p className="mt-2 text-sm text-white/70">{seller.isVerified && <span className="mr-2 rounded-full bg-mint px-2 py-1 text-xs font-bold text-ink">Seller terverifikasi</span>}<span className="text-coral">{reviews._avg.rating ? `★ ${reviews._avg.rating.toFixed(1)}` : "Belum ada rating"}</span><span className="mx-2">·</span>{total} produk</p></div></div><StoreChatButton sellerId={seller.id} /></div><p className="mt-6 max-w-2xl text-sm leading-6 text-white/75">{seller.description || "Selamat datang di toko kami."}</p></div></section><section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Katalog toko</p><h2 className="display mt-2 text-3xl font-bold">Produk Toko</h2><p className="mt-2 text-sm text-ink/55">{reviews._count._all ? `${reviews._count._all} ulasan` : "Belum ada ulasan"}</p></div><form className="flex w-full flex-wrap gap-2 rounded-2xl bg-white p-2 shadow-soft sm:w-auto sm:rounded-full"><input name="q" defaultValue={search} placeholder="Cari di toko..." className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none sm:w-44 sm:rounded-full" /><select name="category" defaultValue={query.category ?? ""} className="rounded-xl bg-sand px-2 py-2 text-sm"><option value="">Semua kategori</option>{categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select><select name="sort" defaultValue={query.sort ?? "newest"} className="rounded-xl bg-sand px-2 py-2 text-sm"><option value="newest">Terbaru</option><option value="price-asc">Harga Terendah</option><option value="price-desc">Harga Tertinggi</option><option value="rating">Rating</option></select><button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white sm:rounded-full">Terapkan</button></form></div><div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">{productsWithStock.length ? productsWithStock.map((product) => <ProductCard key={product.id} product={product} />) : <p className="col-span-full rounded-2xl border border-dashed border-ink/20 p-10 text-center text-sm text-ink/60">Belum ada produk di toko ini.</p>}</div>{totalPages > 1 && <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pagination"><a className={`rounded-full border px-4 py-2 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={paramsFor({ page: String(page - 1) })}>Sebelumnya</a><span className="text-ink/60">Halaman {page} / {totalPages}</span><a className={`rounded-full border px-4 py-2 ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`} href={paramsFor({ page: String(page + 1) })}>Berikutnya</a></nav>}</section></main>;
}
