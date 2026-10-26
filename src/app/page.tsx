import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import Link from "next/link";
import { RetryButton } from "@/components/retry-button";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { PromoSlider } from "@/components/promo-slider";
import { attachStock } from "@/lib/product-stock";
import { getActivePromotions, getHomepagePromotionSlides } from "@/lib/promotions";
import { getCatalogPage } from "@/lib/catalog-pagination";
import { attachProductRatingSummaries } from "@/lib/product-ratings";

export const dynamic = "force-dynamic";
async function storefrontData(requestedPage: number, query?: string, category?: string) {
  try {
    const now = new Date();
    const where = {
      isPublished: true,
      moderationStatus: "APPROVED" as const,
      ...activeSellerProductWhere(),
      ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" as const } }, { shortDescription: { contains: query, mode: "insensitive" as const } }] } : {}),
      ...(category ? { category: { slug: category } } : {}),
    };
    const [products, categories] = await Promise.all([
      getCatalogPage({ where, page: requestedPage, now }),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
    ]);
    const activePromotionSlides = await getActivePromotions(now).catch((error: unknown) => {
      console.error("Homepage seller promotions unavailable", { error: error instanceof Error ? error.message : "Unknown error" });
      return [];
    });
    const ratedProducts = await attachProductRatingSummaries(products.products);
    return {
      products: await attachStock(ratedProducts),
      categories,
      sellerSlides: getHomepagePromotionSlides(activePromotionSlides),
      currentPage: products.currentPage,
      totalPages: products.totalPages,
      unavailable: false,
    };
  } catch (error) {
    console.error("Homepage storefront data unavailable", { error: error instanceof Error ? error.message : "Unknown error" });
    return { products: [], categories: [], sellerSlides: [], currentPage: 1, totalPages: 1, unavailable: true };
  }
}

export default async function Home({ searchParams }: {
  searchParams: Promise<{ page?: string | string[]; q?: string; category?: string }>
}) {
  const params = await searchParams;
  const rawPage = params.page;
  const parsedPage = typeof rawPage === "string" && /^\d+$/.test(rawPage)
    ? Number(rawPage) : 1;
  const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0
    ? parsedPage : 1;
  const query = params.q?.trim();
  const category = params.category;
  const { products, categories, sellerSlides, currentPage, totalPages, unavailable } =
    await storefrontData(requestedPage, query, category);
  const firstPage = Math.min(
    Math.max(currentPage - 1, 1), Math.max(totalPages - 2, 1)
  );
  const pageNumbers = Array.from(
    { length: Math.min(3, totalPages) }, (_, index) => firstPage + index
  );

  const latestProducts = products.slice(0, 4);
  const moreProducts = products.slice(4);
  return <main>
    <section className="grain border-b border-ink/10">
      <div className="mx-auto max-w-6xl px-5 pb-7 pt-3 sm:pb-10 sm:pt-5">
        <PromoSlider promos={sellerSlides} />
        <form action="/" className="mt-4 flex max-w-3xl gap-2 rounded-2xl bg-white p-2 shadow-soft sm:mt-6 sm:rounded-full">
          <label htmlFor="product-search" className="sr-only">Cari produk</label>
          <input id="product-search" name="q" type="search" defaultValue={query} placeholder="Cari produk..." className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-ink/40 sm:rounded-full" />
          <button type="submit" className="shrink-0 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-coral sm:rounded-full">Cari</button>
        </form>
      </div>
    </section>

    <section className="mx-auto max-w-6xl px-5 py-8 sm:py-10" aria-labelledby="categories-heading">
      <div className="flex items-center justify-between gap-4"><h2 id="categories-heading" className="display text-2xl font-bold sm:text-3xl">Jelajahi Kategori</h2><Link href="/products" className="hidden text-sm font-semibold text-coral sm:inline">Semua produk</Link></div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{categories.map((category) => <Link key={category.id} href={"/products?category=" + category.slug as never} className="shrink-0 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold transition hover:border-coral hover:text-coral">{category.name}</Link>)}{!categories.length && <span className="text-sm text-ink/55">Kategori akan tampil setelah database di-seed.</span>}</div>
    </section>

    <section className="mx-auto max-w-6xl px-5 pb-10 sm:pb-14" aria-labelledby="latest-heading">
      <div className="mb-5 flex items-end justify-between gap-4 sm:mb-7"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-coral">Update terbaru</p><h2 id="latest-heading" className="display mt-1 text-3xl font-bold sm:text-4xl">Produk Terbaru</h2></div><Link href="/products" className="shrink-0 text-sm font-semibold underline underline-offset-4 hover:text-coral">Lihat Semua</Link></div>
      {unavailable ? <div className="ui-state" role="alert"><h3 className="font-bold">Katalog belum dapat dimuat</h3><p>Terjadi kendala saat mengambil produk. Silakan coba lagi.</p><RetryButton /></div> : latestProducts.length ? <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">{latestProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <EmptyProducts />}
    </section>

    {!unavailable && moreProducts.length > 0 && <section className="mx-auto max-w-6xl px-5 pb-14 sm:pb-20" aria-labelledby="more-heading"><div className="mb-5"><h2 id="more-heading" className="display text-2xl font-bold sm:text-3xl">Produk lainnya</h2></div><div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">{moreProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div></section>}
    {totalPages > 1 && <nav
      aria-label="Halaman produk"
      className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2 px-5 pb-14"
    >
      {currentPage > 1 && <Link
        href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}), page: String(currentPage - 1) })}#latest-heading` as never}
        rel="prev"
        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm font-semibold hover:text-coral"
      >Sebelumnya</Link>}
      {pageNumbers.map((page) => <Link
        key={page}
        href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}), page: String(page) })}#latest-heading` as never}
        aria-current={page === currentPage ? "page" : undefined}
        aria-label={`Halaman ${page}`}
        className={`rounded-xl px-4 py-3 text-sm font-bold ${
          page === currentPage
            ? "bg-ink text-white"
            : "border border-ink/15 bg-white hover:text-coral"
        }`}
      >{page}</Link>)}
      {currentPage < totalPages && <Link
        href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}), page: String(currentPage + 1) })}#latest-heading` as never}
        rel="next"
        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm font-semibold hover:text-coral"
      >Selanjutnya</Link>}
      <p className="mt-2 w-full text-center text-xs text-ink/55">
        Halaman {currentPage} dari {totalPages}
      </p>
    </nav>}
  </main>;
}

function EmptyProducts() {
  return <div className="rounded-2xl border border-dashed border-ink/20 p-8 text-center text-sm text-ink/60">Produk akan tampil setelah database di-seed.</div>;
}
