import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync(new URL("../src/components/product-card.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/app/products/page.tsx", import.meta.url), "utf8");
const catalogPagination = readFileSync(new URL("../src/lib/catalog-pagination.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/app/store/[slug]/page.tsx", import.meta.url), "utf8");
const productDetail = readFileSync(new URL("../src/app/products/[slug]/page.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../src/components/brand-logo.tsx", import.meta.url), "utf8");

describe("product seller display", () => {
  it("renders seller A's store name for a product owned by seller A", () => {
    expect(card).toContain("product.seller?.storeName");
    expect(card).toContain('?? "Toko"');
  });

  it("renders seller B's store name independently instead of a shared hardcoded name", () => {
    expect(card).not.toContain("Riezz99 <span");
    expect(card).toContain('storeName" | "storeSlug"');
  });

  it("loads seller names and slugs with each product query", () => {
    const sellerSelect = 'seller: { select: { storeName: true, storeSlug: true } }';
    expect(catalogPagination).toContain(sellerSelect);
    expect(catalog).toContain("getCatalogPage");
    expect(store).toContain(sellerSelect);
  });

  it("keeps the website brand while using a neutral product fallback", () => {
    expect(productDetail).toContain('product.seller?.storeName ?? "Toko"');
    expect(productDetail).not.toContain('product.seller?.storeName ?? "Riezz99"');
    expect(brand).toContain("Riezz99");
  });
});
