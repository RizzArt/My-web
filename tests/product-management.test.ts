import { describe, expect, it } from "vitest";
import { productData } from "@/lib/product-input";
import { uniqueProductSlug } from "@/lib/product-slug";

const base = { name: "Template CV Premium", description: "Template profesional", price: "100000", categoryId: "cat", type: "FILE", galleryUrls: "" };

describe("product management defaults", () => {
  it("does not require a client slug and defaults automatic delivery", () => {
    const product = productData(base);
    expect(product.deliveryMode).toBe("AUTO");
    expect(product.seoTitle).toBe("Template CV Premium");
  });

  it("creates a unique numeric suffix for duplicate names", async () => {
    const seen = new Set(["template-cv-premium"]);
    const tx = { product: { findFirst: async ({ where }: { where: { slug: string } }) => seen.has(where.slug) ? { id: "existing" } : null } };
    await expect(uniqueProductSlug(tx, "Template CV Premium")).resolves.toBe("template-cv-premium-2");
  });
});
