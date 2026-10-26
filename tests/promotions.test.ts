import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatPromotionDate, getHomepagePromotionSlides, getPlatformPromotions, isPromotionCurrentlyActive, getActivePromotions, mergePromotionSlides, normalizePromotionSlides, promotionPrice, promotionSlidesFromRows, type PromotionSlide } from "@/lib/promotions";
import { getVisiblePromos, isSafePromoHref, PromoSlider, shouldAutoSlide } from "@/components/promo-slider";
import { prisma } from "@/lib/prisma";

vi.stubGlobal("React", React);

const row = (overrides: Partial<{ id: string; productId: string; stock: number }>) => ({
  id: overrides.id ?? "seller-promo",
  title: "Diskon seller",
  subtitle: null,
  ctaText: null,
  bannerUrl: null,
  seller: { storeName: "Toko Seller", storeSlug: "toko-seller" },
  product: { id: overrides.productId ?? "product-1", name: "Produk", slug: "produk", thumbnailUrl: null, type: "FILE" as const, stock: overrides.stock ?? 1, deliveryMode: "AUTO" as const },
});

describe("promotion packages and visibility", () => {
  it("uses only the fixed IDR packages", () => {
    expect(promotionPrice(7)).toBe(5000);
    expect(promotionPrice(14)).toBe(10000);
    expect(promotionPrice(30)).toBe(15000);
    expect(promotionPrice(10)).toBeNull();
  });
  it("does not show pending or expired promotions", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    expect(isPromotionCurrentlyActive({ status: "ACTIVE", startsAt: new Date("2026-09-26T00:00:00Z"), endsAt: new Date("2026-09-28T00:00:00Z") }, now)).toBe(true);
    expect(isPromotionCurrentlyActive({ status: "ACTIVE", startsAt: new Date("2026-09-25T00:00:00Z"), endsAt: now }, now)).toBe(false);
    expect(isPromotionCurrentlyActive({ status: "PENDING", startsAt: null, endsAt: null }, now)).toBe(false);
  });
  it("always creates an array for empty active promotions", () => {
    expect(promotionSlidesFromRows([], new Set())).toEqual([]);
  });
  it("provides platform promotions as an explicit array contract", () => {
    expect(Array.isArray(getPlatformPromotions())).toBe(true);
  });
  it("active promotion helper returns an array when the query is empty", async () => {
    const findMany = vi.spyOn(prisma.promotion, "findMany").mockResolvedValue([]);
    await expect(getActivePromotions()).resolves.toEqual([]);
    findMany.mockRestore();
  });
  it("merges seller slides with platform slides without changing either array", () => {
    const platform: PromotionSlide[] = [{ id: "platform", title: "Platform", subtitle: "", ctaLabel: "Lihat", ctaHref: "/products", active: true }];
    const seller = promotionSlidesFromRows([row({})], new Set(["product-1"]));
    expect([...seller, ...platform].map((promo) => promo.id)).toEqual(["seller-promo", "platform"]);
  });
  it("does not crash with platform promotions only", () => {
    expect(mergePromotionSlides(getPlatformPromotions(), [])).toHaveLength(3);
  });
  it("does not crash with seller promotions only", () => {
    const seller = promotionSlidesFromRows([row({})], new Set(["product-1"]));
    expect(mergePromotionSlides([], seller)).toEqual(seller);
  });
  it("merges platform and seller promotions into one slider array", () => {
    const seller = promotionSlidesFromRows([row({})], new Set(["product-1"]));
    expect(mergePromotionSlides(getPlatformPromotions(), seller)).toHaveLength(4);
  });
  it("reproduces the homepage regression where an active seller promotion must be the first slide", () => {
    const activeSellerSlides = promotionSlidesFromRows([row({})], new Set(["product-1"]));
    expect(getHomepagePromotionSlides(activeSellerSlides)).toEqual(activeSellerSlides);
    expect(getHomepagePromotionSlides([])).toEqual(getPlatformPromotions());
  });
  it("keeps the homepage safe when both promotion sources are empty", () => {
    expect(mergePromotionSlides([], [])).toEqual([]);
  });
  it("normalizes an invalid platform promotion value to an empty array", () => {
    expect(normalizePromotionSlides({ platformPromos: getPlatformPromotions() })).toEqual([]);
    expect(mergePromotionSlides({ platformPromos: getPlatformPromotions() }, [])).toEqual([]);
  });
  it("passes the final typed array contract to the slider helper", () => {
    const finalPromos = mergePromotionSlides(getPlatformPromotions(), []);
    expect(getVisiblePromos(finalPromos)).toEqual(finalPromos);
  });
  it("does not include promotions for products with no stock", () => {
    expect(promotionSlidesFromRows([row({ stock: 0 })], new Set())).toEqual([]);
  });
  it("keeps the slider safe when no seller promotion exists", () => {
    expect(getVisiblePromos(undefined)).toEqual([]);
    expect(getVisiblePromos(null)).toEqual([]);
  });
  it("does not expose an empty slider or unsafe promotion target", () => {
    expect(renderToStaticMarkup(React.createElement(PromoSlider, { promos: [] }))).toBe("");
    expect(isSafePromoHref("/products")).toBe(true);
    expect(isSafePromoHref("//untrusted.example")).toBe(false);
    expect(isSafePromoHref("javascript:alert(1)")).toBe(false);
    expect(getVisiblePromos([{ id: "unsafe", title: "Unsafe", subtitle: "", ctaLabel: "Open", ctaHref: "//untrusted.example", active: true }])).toEqual([]);
  });
  it("keeps a single promotion stable without redundant navigation", () => {
    const html = renderToStaticMarkup(React.createElement(PromoSlider, { promos: [{ id: "one", title: "Satu", subtitle: "", ctaLabel: "Buka", ctaHref: "/products", active: true }] }));
    expect(html).toContain("Satu");
    expect(html).not.toContain("Promosi sebelumnya");
    expect(html).not.toContain("Promosi berikutnya");
  });
  it("renders accessible navigation for multiple promotions", () => {
    const promos: PromotionSlide[] = ["one", "two"].map((id) => ({ id, title: id, subtitle: "", ctaLabel: "Buka", ctaHref: "/products", active: true }));
    const html = renderToStaticMarkup(React.createElement(PromoSlider, { promos }));
    expect(html).toContain('aria-label="Promosi sebelumnya"');
    expect(html).toContain('aria-label="Promosi berikutnya"');
    expect(html).toContain('aria-label="Jeda pergeseran promosi"');
  });
  it("disables automatic movement for a paused, single, or reduced-motion carousel", () => {
    expect(shouldAutoSlide(2, false, false)).toBe(true);
    expect(shouldAutoSlide(1, false, false)).toBe(false);
    expect(shouldAutoSlide(2, true, false)).toBe(false);
    expect(shouldAutoSlide(2, false, true)).toBe(false);
  });
  it("does not include expired or rejected promotions in the active query contract", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    expect(isPromotionCurrentlyActive({ status: "REJECTED", startsAt: new Date("2026-09-26T00:00:00Z"), endsAt: new Date("2026-09-28T00:00:00Z") }, now)).toBe(false);
    expect(isPromotionCurrentlyActive({ status: "ACTIVE", startsAt: new Date("2026-09-26T00:00:00Z"), endsAt: new Date("2026-09-27T00:00:00Z") }, now)).toBe(false);
  });
  it("queries only approved promotions inside the server-time window", async () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const findMany = vi.spyOn(prisma.promotion, "findMany").mockResolvedValue([]);
    await getActivePromotions(now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVE", approvedAt: { not: null }, startsAt: { lte: now }, endsAt: { gt: now } }) }));
    findMany.mockRestore();
  });
  it("uses the seller store URL and WIB for seller-facing promotion data", () => {
    const slide = promotionSlidesFromRows([row({})], new Set(["product-1"]))[0];
    expect(slide?.storeName).toBe("Toko Seller");
    expect(slide?.ctaHref).toBe("/store/toko-seller");
    expect(formatPromotionDate(new Date("2026-09-27T00:00:00Z"))).toContain("WIB");
  });
});
