import { describe, expect, it } from "vitest";
import { normalizeSlug, RESERVED_SLUGS, productVisibilityWhere } from "@/lib/seller";
import { productData } from "@/lib/product-input";

describe("seller and product safety rules", () => {
  it("normalizes slugs and blocks reserved routes", () => {
    expect(normalizeSlug(" My New Store! ")).toBe("my-new-store");
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
  });
  it("publishes only approved products", () => {
    expect(productVisibilityWhere()).toEqual({ isPublished: true, moderationStatus: "APPROVED" ,
      AND: [{
        OR: [
          { sellerId: null },
          { seller: { is: {
            isActive: true,
            user: { is: { isActive: true, role: "SELLER" } },
          } } },
        ],
      }],
    });
  });
  it("normalizes product gallery data without trusting client ownership", () => {
    const product = productData({ name: "Test", slug: "test", description: "A product", price: "1000", categoryId: "cat", type: "FILE", sellerId: "other", galleryUrls: "https://example.com/a.jpg\nhttps://example.com/b.jpg" });
    expect(product.galleryUrls).toEqual(["https://example.com/a.jpg", "https://example.com/b.jpg"]);
    expect(product.sellerId).toBe("other");
  });
});
