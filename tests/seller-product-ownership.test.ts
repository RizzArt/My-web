import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sellerCreate = readFileSync(new URL("../src/app/api/seller/products/route.ts", import.meta.url), "utf8");
const productRoute = readFileSync(new URL("../src/app/api/products/[productId]/route.ts", import.meta.url), "utf8");
const adminCreate = readFileSync(new URL("../src/app/api/admin/products/route.ts", import.meta.url), "utf8");
const adminList = readFileSync(new URL("../src/app/admin/products/page.tsx", import.meta.url), "utf8");
const moderation = readFileSync(new URL("../src/lib/product-moderation.ts", import.meta.url), "utf8");
const repair = readFileSync(new URL("../scripts/repair-seller-product-ownership.ts", import.meta.url), "utf8");

describe("seller product ownership", () => {
  it("stores seller ownership from the authenticated SellerProfile", () => {
    expect(sellerCreate).toContain("findUnique({ where: { userId: session.user.id } })");
    expect(sellerCreate).toContain("sellerId: seller.id");
  });

  it("uses SellerProfile.id, matching Product.sellerId", () => {
    expect(sellerCreate).toContain("sellerId: seller.id");
    expect(sellerCreate).not.toContain("sellerId: session.user.id");
  });

  it("preserves ownership during seller edits", () => {
    expect(productRoute).toContain("sellerId: current.sellerId");
    expect(productRoute).not.toContain("sellerId: null");
  });

  it("ignores client sellerId values on seller and admin writes", () => {
    expect(sellerCreate).toContain("sellerId: seller.id");
    expect(productRoute).toContain("sellerId: _ignoredSellerId");
    expect(adminCreate).toContain("sellerId: _ignoredSellerId");
  });

  it("keeps admin-created products as platform products", () => {
    expect(adminCreate).toContain("sellerId: null");
    expect(adminCreate).toContain('moderationStatus: "APPROVED"');
  });

  it("does not put platform products in the pending seller queue", () => {
    expect(adminList).toContain('moderation === "PENDING_REVIEW"');
    expect(adminList).toContain('seller: { isNot: null }');
  });

  it("keeps the seller ownership moderation guard", () => {
    expect(moderation).toContain("Hanya produk seller yang dapat dimoderasi.");
    expect(moderation).toContain("!current.sellerId || !current.seller?.userId");
  });

  it("supports approval side effects", () => {
    expect(moderation).toContain('moderationStatus: input.status');
    expect(moderation).toContain("rejectionReason: input.status === \"REJECTED\" ?");
    expect(moderation).toContain("isPublished: input.status === \"APPROVED\"");
    expect(moderation).toContain("PRODUCT_MODERATION");
  });

  it("supports rejection side effects", () => {
    expect(moderation).toContain('action: `PRODUCT_${input.status}`');
    expect(moderation).toContain("Alasan: ${input.rejectionReason!.trim()}");
  });

  it("does not allow orphan moderation", () => {
    expect(moderation).toContain("if (!current.sellerId || !current.seller?.userId)");
  });

  it("repairs only ownership proven by seller creation audit data", () => {
    expect(repair).toContain('action: "SELLER_PRODUCT_CREATED"');
    expect(repair).toContain("actor.sellerProfile?.id");
    expect(repair).toContain('sellerId: null');
    expect(repair).toContain("process.argv.includes(\"--apply\")");
  });
});
