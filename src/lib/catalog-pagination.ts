import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activePromotionWhere } from "@/lib/promotions";

export const CATALOG_PAGE_SIZE = 10;

const productInclude = {
  category: true,
  seller: { select: { storeName: true, storeSlug: true } },
} as const;

export type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type CatalogPageInput = {
  where: Prisma.ProductWhereInput;
  page?: number;
  now?: Date;
};

type CatalogPage = {
  products: CatalogProduct[];
  currentPage: number;
  totalPages: number;
};

export function dedupePromotedProductIds(rows: readonly { productId: string }[]) {
  const seen = new Set<string>();
  return rows.flatMap(({ productId }) => {
    if (seen.has(productId)) return [];
    seen.add(productId);
    return [productId];
  });
}

export function orderPriorityProducts<T extends { id: string }>(products: readonly T[], promotionRank: ReadonlyMap<string, number>) {
  return [...products].sort((left, right) => {
    const rankDifference = (promotionRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (promotionRank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    return rankDifference || left.id.localeCompare(right.id);
  });
}

async function getPromotedProductIds(now: Date) {
  const rows = await prisma.promotion.findMany({
    where: activePromotionWhere(now),
    select: { productId: true },
    orderBy: [
      { approvedAt: "desc" },
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  return dedupePromotedProductIds(rows);
}

export async function getCatalogPage({ where, page = 1, now = new Date() }: CatalogPageInput): Promise<CatalogPage> {
  const requestedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const promotedProductIds = await getPromotedProductIds(now);
  const priorityWhere: Prisma.ProductWhereInput = promotedProductIds.length
    ? { AND: [where, { id: { in: promotedProductIds } }] }
    : { AND: [where, { id: "__no_promoted_products__" }] };
  const regularWhere: Prisma.ProductWhereInput = promotedProductIds.length
    ? { AND: [where, { id: { notIn: promotedProductIds } }] }
    : where;

  const promotionRank = new Map(promotedProductIds.map((id, index) => [id, index]));
  const [total, unorderedPriorityProducts] = await Promise.all([
    prisma.product.count({ where }),
    promotedProductIds.length
      ? prisma.product.findMany({ where: priorityWhere, include: productInclude })
      : Promise.resolve([] as CatalogProduct[]),
  ]);
  const priorityProducts = orderPriorityProducts(unorderedPriorityProducts, promotionRank);
  const priorityCount = priorityProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * CATALOG_PAGE_SIZE;
  const regularOrderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  let products: CatalogProduct[];

  if (offset < priorityCount) {
    const priorityTake = Math.min(CATALOG_PAGE_SIZE, priorityCount - offset);
    const pagePriorityProducts = priorityProducts.slice(offset, offset + priorityTake);
    const remaining = CATALOG_PAGE_SIZE - pagePriorityProducts.length;
    const regularProducts = remaining > 0
      ? await prisma.product.findMany({ where: regularWhere, include: productInclude, orderBy: regularOrderBy, take: remaining })
      : [];
    products = [...pagePriorityProducts, ...regularProducts];
  } else {
    products = await prisma.product.findMany({
      where: regularWhere,
      include: productInclude,
      orderBy: regularOrderBy,
      skip: offset - priorityCount,
      take: CATALOG_PAGE_SIZE,
    });
  }

  return { products, currentPage, totalPages };
}
