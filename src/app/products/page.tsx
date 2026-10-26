import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { attachStock } from "@/lib/product-stock";
import { getCatalogPage } from "@/lib/catalog-pagination";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; page?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim();
  const page = Number.parseInt(params.page ?? "1", 10);
  const where = {
    isPublished: true,
    moderationStatus: "APPROVED" as const,
    ...activeSellerProductWhere(),
    ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" as const } }, { shortDescription: { contains: query, mode: "insensitive" as const } }] } : {}),
    ...(params.category ? { category: { slug: params.category } } : {}),
  };
  const [catalog, categories] = await Promise.all([
    getCatalogPage({ where, page }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  const productsWithStock = await attachStock(catalog.products);
  const paramsFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (params.category) next.set("category", params.category);
    Object.entries(overrides).forEach(([key, value]) => next.set(key, value));
    return `/products?${next}`;
  };
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:py-16"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Katalog</p><h1 className="display mt-3 text-4xl font-bold tracking-tight sm:text-6xl">Semua produk</h1><p className="mt-4 max-w-xl text-sm text-ink/60 sm:text-lg">Beli sekali, pakai berkali-kali. Semua produk dikirim secara digital setelah pembayaran.</p></div><form action="/products" className="flex w-full flex-wrap gap-2 rounded-2xl bg-white p-2 shadow-soft sm:w-auto sm:rounded-full"><label htmlFor="catalog-search" className="sr-only">Cari produk</label><input id="catalog-search" name="q" defaultValue={query} placeholder="Cari produk..." className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-sm outline-none sm:w-52 sm:rounded-full" /><select aria-label="Kategori produk" name="category" defaultValue={params.category ?? ""} className="rounded-xl bg-sand px-2 py-2 text-sm"><option value="">Semua kategori</option>{categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select><button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white sm:rounded-full">Cari</button></form></div><div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">{productsWithStock.length ? productsWithStock.map((product) => <ProductCard key={product.id} product={product} />) : <p className="col-span-full rounded-2xl border border-dashed border-ink/20 p-10 text-center text-sm text-ink/60">Produk tidak ditemukan.</p>}</div>{catalog.totalPages > 1 && <nav className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm" aria-label="Halaman katalog">{catalog.currentPage > 1 && <a href={paramsFor({ page: String(catalog.currentPage - 1) })} rel="prev" className="rounded-xl border border-ink/15 bg-white px-4 py-3 font-semibold hover:text-coral">Sebelumnya</a>}{Array.from({ length: Math.min(3, catalog.totalPages) }, (_, index) => Math.min(Math.max(catalog.currentPage - 1, 1), Math.max(catalog.totalPages - 2, 1)) + index).map((number) => <a key={number} href={paramsFor({ page: String(number) })} aria-current={number === catalog.currentPage ? "page" : undefined} className={`rounded-xl px-4 py-3 font-bold ${number === catalog.currentPage ? "bg-ink text-white" : "border border-ink/15 bg-white hover:text-coral"}`}>{number}</a>)}{catalog.currentPage < catalog.totalPages && <a href={paramsFor({ page: String(catalog.currentPage + 1) })} rel="next" className="rounded-xl border border-ink/15 bg-white px-4 py-3 font-semibold hover:text-coral">Berikutnya</a>}<span className="w-full text-center text-xs text-ink/55">Halaman {catalog.currentPage} dari {catalog.totalPages}</span></nav>}</main>;
}
