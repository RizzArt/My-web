import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCard } from "@/components/product-card";
import { CATALOG_PAGE_SIZE, dedupePromotedProductIds, getCatalogPage, orderPriorityProducts } from "@/lib/catalog-pagination";
import { prisma } from "@/lib/prisma";

vi.stubGlobal("React", React);

type Product = { id: string; slug: string; sellerId?: string; createdAt?: Date };

const product = (id: string, createdAt = "2026-10-01T00:00:00.000Z"): Product => ({
  id,
  slug: id,
  createdAt: new Date(createdAt),
});

function catalogMocks({ promotionRows, priorityProducts, regularProducts }: {
  promotionRows: { productId: string }[];
  priorityProducts: Product[];
  regularProducts: Product[];
}) {
  vi.spyOn(prisma.promotion, "findMany").mockResolvedValue(promotionRows as never);
  vi.spyOn(prisma.product, "count").mockResolvedValue(priorityProducts.length + regularProducts.length);
  return vi.spyOn(prisma.product, "findMany").mockImplementation(async (args) => {
    const where = JSON.stringify(args.where);
    const source = where.includes('"id":{"in":') ? priorityProducts : regularProducts;
    const skip = args.skip ?? 0;
    return source.slice(skip, skip + (args.take ?? source.length)) as never;
  });
}

describe("catalog pagination priority", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts four active promoted products first even when one is older than every regular product", async () => {
    const promoted = [
      product("chatgpt-business-standard-setara-plus", "2026-10-07T00:00:00.000Z"),
      product("leonardo-ai-8500-kredit-2", "2026-10-06T00:00:00.000Z"),
      product("leonardo-ai-17000-kredit", "2026-10-05T00:00:00.000Z"),
      product("leonardo-ai-8500-kredit", "2020-01-01T00:00:00.000Z"),
    ];
    const regular = [
      product("youtube-premium-30-day", "2026-10-04T00:00:00.000Z"),
      product("canva-pro-30-day", "2026-10-03T00:00:00.000Z"),
      product("capcut-pro-30-day", "2026-10-02T00:00:00.000Z"),
    ];
    const findMany = catalogMocks({
      promotionRows: [...promoted.map(({ id }) => ({ productId: id })), { productId: promoted[3]!.id }],
      // Prisma `id: { in: [...] }` has no ordering contract. Deliberately return a different order.
      priorityProducts: [promoted[3]!, promoted[1]!, promoted[2]!, promoted[0]!],
      regularProducts: regular,
    });

    const page = await getCatalogPage({ where: { isPublished: true, moderationStatus: "APPROVED" }, now: new Date("2026-10-11T00:00:00.000Z") });
    const promotedIds = new Set(promoted.map(({ id }) => id));
    const firstRegularIndex = page.products.findIndex((item) => !promotedIds.has(item.id));
    const promotedAfterRegular = page.products.slice(firstRegularIndex).some((item) => promotedIds.has(item.id));

    expect(page.products.map((item) => item.slug)).toEqual([...promoted, ...regular].map(({ slug }) => slug));
    expect(promotedAfterRegular).toBe(false);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ id: { notIn: promoted.map(({ id }) => id) } })]) }),
    }));
  });

  it("continues promoted products onto later pages before regular products without duplicates or omissions", async () => {
    const promoted = Array.from({ length: CATALOG_PAGE_SIZE + 2 }, (_, index) => product(`promoted-${index + 1}`));
    const regular = [product("regular-1"), product("regular-2"), product("regular-3")];
    catalogMocks({
      promotionRows: promoted.map(({ id }) => ({ productId: id })),
      priorityProducts: [...promoted].reverse(),
      regularProducts: regular,
    });
    const where = { isPublished: true, moderationStatus: "APPROVED" as const };
    const firstPage = await getCatalogPage({ where, page: 1, now: new Date("2026-10-11T00:00:00.000Z") });
    const secondPage = await getCatalogPage({ where, page: 2, now: new Date("2026-10-11T00:00:00.000Z") });
    const all = [...firstPage.products, ...secondPage.products].map(({ id }) => id);

    expect(firstPage.products.map(({ id }) => id)).toEqual(promoted.map(({ id }) => id).slice(0, CATALOG_PAGE_SIZE));
    expect(secondPage.products.map(({ id }) => id)).toEqual([...promoted.slice(CATALOG_PAGE_SIZE), ...regular].map(({ id }) => id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...promoted, ...regular].map(({ id }) => id));
    expect(secondPage.totalPages).toBe(2);
  });

  it("deduplicates promotion rows while retaining their explicit approval ranking", () => {
    expect(dedupePromotedProductIds([
      { productId: "first" }, { productId: "first" }, { productId: "second" }, { productId: "third" }, { productId: "second" },
    ])).toEqual(["first", "second", "third"]);
  });

  it("does not assume that database id-in results follow input order", () => {
    const rank = new Map([["first", 0], ["second", 1], ["third", 2]]);
    const shuffled = [{ id: "third" }, { id: "first" }, { id: "second" }];
    expect(orderPriorityProducts(shuffled, rank).map(({ id }) => id)).toEqual(["first", "second", "third"]);
    expect(shuffled.map(({ id }) => id)).toEqual(["third", "first", "second"]);
  });

  it("applies active-promotion and homepage search/category filters to priority products", async () => {
    const findPromotions = vi.spyOn(prisma.promotion, "findMany").mockResolvedValue([{ productId: "matching" }] as never);
    vi.spyOn(prisma.product, "count").mockResolvedValue(1);
    const findProducts = vi.spyOn(prisma.product, "findMany").mockResolvedValue([product("matching")] as never);
    const where = {
      isPublished: true,
      moderationStatus: "APPROVED" as const,
      OR: [{ name: { contains: "template", mode: "insensitive" as const } }],
      category: { slug: "design" },
    };

    await getCatalogPage({ where, now: new Date("2026-10-11T00:00:00.000Z") });

    expect(findPromotions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "ACTIVE",
        approvedAt: { not: null },
        startsAt: { lte: expect.any(Date) },
        endsAt: { gt: expect.any(Date) },
        seller: expect.any(Object),
        product: { isPublished: true, moderationStatus: "APPROVED" },
      }),
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    }));
    expect(findProducts).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([where, { id: { in: ["matching"] } }]) }),
    }));
  });

  it("renders a promoted prefix in card-anchor HTML", async () => {
    const promoted = [product("promoted-1"), product("promoted-2"), product("promoted-3"), product("promoted-4")];
    const regular = [product("regular-1"), product("regular-2"), product("regular-3")];
    catalogMocks({
      promotionRows: promoted.map(({ id }) => ({ productId: id })),
      priorityProducts: [...promoted].reverse(),
      regularProducts: regular,
    });
    const page = await getCatalogPage({ where: { isPublished: true, moderationStatus: "APPROVED" }, now: new Date("2026-10-11T00:00:00.000Z") });
    const html = renderToStaticMarkup(React.createElement("div", null,
      page.products.map((item) => React.createElement(ProductCard, {
        key: item.id,
        product: { ...item, name: item.slug, price: 1000, shortDescription: null, thumbnailUrl: null, isFeatured: false },
      })),
    ));

    expect([...html.matchAll(/href="\/products\/([^"?#]+)"/g)].map((match) => match[1])).toEqual([...promoted, ...regular].map(({ slug }) => slug));
  });
});
