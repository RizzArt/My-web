import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/product-card";
import { ProductGallery } from "@/components/product-gallery";
import { displayLabel } from "@/lib/display-labels";

vi.stubGlobal("React", React);
const product = { name: "Produk contoh", slug: "contoh", price: 12000, shortDescription: "Contoh", thumbnailUrl: null, isFeatured: false };

describe("marketplace presentation", () => {
  it("does not invent a product rating or instant-delivery claim", () => {
    const html = renderToStaticMarkup(React.createElement(ProductCard, { product }));
    expect(html).toContain("Rp 12.000");
    expect(html).toContain("Belum ada ulasan");
    expect(html).not.toMatch(/5\.0|Digital instan|terverifikasi/);
  });
  it("shows only the persisted aggregate rating and review count", () => {
    const html = renderToStaticMarkup(React.createElement(ProductCard, { product: { ...product, ratingSummary: { average: 4.75, count: 12 } } }));
    expect(html).toContain("★");
    expect(html).toContain("4,8");
    expect(html).toContain("(12)");
    expect(html).not.toContain("Belum ada ulasan");
  });
  it("shows unavailable stock without removing the product link", () => {
    const html = renderToStaticMarkup(React.createElement(ProductCard, { product: { ...product, stockInfo: { kind: "finite", quantity: 0, available: false } } }));
    expect(html).toContain("Habis");
    expect(html).toContain('/products/contoh');
  });
  it("provides labelled controls for every gallery image, including images after the fourth", () => {
    const images = Array.from({ length: 7 }, (_, i) => `/image-${i}.png`);
    const html = renderToStaticMarkup(React.createElement(ProductGallery, { images, name: product.name }));
    expect(html).toContain('aria-label="Lihat gambar 7 dari 7"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(6);
  });
  it("shows an explicit empty gallery and keeps internal enum values out of fallback labels", () => {
    expect(renderToStaticMarkup(React.createElement(ProductGallery, { images: [], name: product.name }))).toContain("Gambar produk belum tersedia");
    expect(displayLabel("REFUND_CREDIT")).toBe("Pengembalian dana");
    expect(displayLabel("UNKNOWN_INTERNAL_STATUS")).toBe("Status belum tersedia");
  });
});
