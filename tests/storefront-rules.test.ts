import { describe, expect, it } from "vitest";
import { normalizeSlug, productVisibilityWhere, RESERVED_SLUGS } from "@/lib/seller";

describe("public storefront rules", () => {
  it("creates URL-safe store slugs from store names", () => {
    expect(normalizeSlug("Riezz Digital")).toBe("riezz-digital");
  });

  it("keeps reserved routes unavailable as store slugs", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(RESERVED_SLUGS.has("riezz-digital")).toBe(false);
  });

  it("uses the existing approved and published product visibility rule", () => {
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

  it("normalizes duplicate suffix inputs consistently", () => {
    expect(normalizeSlug("Riezz Digital 2")).toBe("riezz-digital-2");
    expect(normalizeSlug("  Toko---Baru  ")).toBe("toko-baru");
  });
});
