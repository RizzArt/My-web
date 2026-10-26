/**
 * Read-only production diagnostic for the homepage catalog pipeline.
 *
 * Run it from the release directory with that release's .env loaded. It emits
 * product slugs only; it intentionally never prints environment values or
 * customer data.
 */
import type { Prisma } from "@prisma/client";
import { CATALOG_PAGE_SIZE, dedupePromotedProductIds, getCatalogPage, orderPriorityProducts } from "@/lib/catalog-pagination";
import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import { prisma } from "@/lib/prisma";
import { attachProductRatingSummaries } from "@/lib/product-ratings";
import { attachStock } from "@/lib/product-stock";
import { activePromotionWhere } from "@/lib/promotions";

const slugs = (products: readonly { slug: string }[]) => products.map((product) => product.slug).join("\n");

async function main() {
  const now = new Date();
  const homepageWhere: Prisma.ProductWhereInput = {
    isPublished: true,
    moderationStatus: "APPROVED",
    ...activeSellerProductWhere(),
  };

  // This deliberately mirrors the promotion/ranking work in getCatalogPage.
  const promotionRows = await prisma.promotion.findMany({
    where: activePromotionWhere(now),
    select: { productId: true, product: { select: { slug: true } } },
    orderBy: [
      { approvedAt: "desc" },
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  const promotedProductIds = dedupePromotedProductIds(promotionRows);
  const priorityWhere: Prisma.ProductWhereInput = promotedProductIds.length
    ? { AND: [homepageWhere, { id: { in: promotedProductIds } }] }
    : { AND: [homepageWhere, { id: "__no_promoted_products__" }] };
  const regularWhere: Prisma.ProductWhereInput = promotedProductIds.length
    ? { AND: [homepageWhere, { id: { notIn: promotedProductIds } }] }
    : homepageWhere;
  const regularOrderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const [unorderedPriorityProducts] = await Promise.all([
    prisma.product.findMany({
      where: priorityWhere,
      select: { id: true, slug: true },
    }),
  ]);
  const promotionRank = new Map(promotedProductIds.map((id, index) => [id, index]));
  const priorityProducts = orderPriorityProducts(unorderedPriorityProducts, promotionRank);
  const priorityCount = priorityProducts.length;
  const pagePriorityProducts = priorityProducts.slice(0, CATALOG_PAGE_SIZE);
  const regularProducts = await prisma.product.findMany({
    where: regularWhere,
    select: { id: true, slug: true },
    orderBy: regularOrderBy,
    take: Math.max(0, CATALOG_PAGE_SIZE - pagePriorityProducts.length),
  });

  // This invokes the exact catalog function that app/page.tsx uses.
  const catalog = await getCatalogPage({ where: homepageWhere, page: 1, now });
  const rated = await attachProductRatingSummaries(catalog.products);
  const stocked = await attachStock(rated);
  const slugById = new Map([
    ...promotionRows.map((row) => [row.productId, row.product.slug]),
    ...stocked.map((product) => [product.id, product.slug]),
  ]);
  const activePromotedProductIds = new Set(promotedProductIds);
  const firstRegularIndex = stocked.findIndex((product) => !activePromotedProductIds.has(product.id));
  const promotedAfterRegular = firstRegularIndex === -1 ? false : stocked
    .slice(firstRegularIndex)
    .some((product) => activePromotedProductIds.has(product.id));
  const priorityMissing = promotedProductIds.filter((id) => !priorityProducts.some((product) => product.id === id));

  console.log("promotion row product slugs");
  console.log(slugs(promotionRows.map((row) => row.product)));
  console.log("deduplicated promoted product slugs");
  console.log(slugs(promotedProductIds.map((id) => ({ slug: slugById.get(id) ?? "unknown-product" }))));
  console.log("priority product slugs");
  console.log(slugs(priorityProducts));
  console.log("regular product slugs");
  console.log(slugs(regularProducts));
  console.log("combined catalog product slugs");
  console.log(slugs(catalog.products));
  console.log("after rating enrichment product slugs");
  console.log(slugs(rated));
  console.log("after stock enrichment product slugs");
  console.log(slugs(stocked));
  console.log(`priority count: ${priorityCount}`);
  if (priorityMissing.length) {
    console.error("active promotion missing from priority query");
    console.error(slugs(priorityMissing.map((id) => ({ slug: slugById.get(id) ?? "unknown-product" }))));
  }
  if (promotedAfterRegular) {
    console.error("FAIL: active promoted product appears after a regular product");
  }
  if (priorityMissing.length || promotedAfterRegular) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("Homepage catalog diagnostic failed", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
