import { prisma } from "@/lib/prisma";
import { emptyProductRating, type ProductRatingSummary } from "@/lib/product-rating";

export type ProductWithRating<T extends { id: string }> = T & {
  ratingSummary: ProductRatingSummary;
};

/**
 * Adds persisted review aggregates for a page of products in one query. Product
 * reviews are only created after the purchase and ownership checks in the API,
 * so every stored review is eligible for the public aggregate.
 */
export async function attachProductRatingSummaries<T extends { id: string }>(products: readonly T[]): Promise<ProductWithRating<T>[]> {
  const productIds = [...new Set(products.map((product) => product.id))];
  if (!productIds.length) return products.map((product) => ({ ...product, ratingSummary: emptyProductRating }));

  const rows = await prisma.productReview.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const summaries = new Map(rows.map((row) => [row.productId, {
    average: row._avg.rating,
    count: row._count._all,
  } satisfies ProductRatingSummary]));

  return products.map((product) => ({
    ...product,
    ratingSummary: summaries.get(product.id) ?? emptyProductRating,
  }));
}
