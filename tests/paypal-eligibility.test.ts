import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ seller: vi.fn(), products: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  sellerProfile: { findFirst: mocks.seller },
  product: { findMany: mocks.products },
} }));
vi.mock("@/lib/delivery/service", () => ({ deliverOrder: vi.fn() }));
vi.mock("@/lib/seller-finance", () => ({ createSellerEarningsForPaidOrder: vi.fn() }));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: vi.fn() }));
vi.mock("@/lib/customer-cancellation", () => ({ autoCancelExpiredOrder: vi.fn() }));

import { assertPayPalEligibleOrderItems, canUsePayPalForProductIds, hasOnlyPayPalEligibleSeller } from "@/lib/payments/paypal-eligibility";
import { assertPayPalOrderEligibility } from "@/lib/payments/paypal-service";

const akhiroSellerId = "cmuked1p60007boedzz75hylp";
const own = { product: { sellerId: akhiroSellerId } };
const other = { product: { sellerId: "seller-other-456" } };

beforeEach(() => {
  process.env.PAYPAL_ELIGIBLE_SELLER_ID = akhiroSellerId;
  mocks.seller.mockReset().mockResolvedValue({ id: akhiroSellerId });
  mocks.products.mockReset();
});

afterEach(() => { delete process.env.PAYPAL_ELIGIBLE_SELLER_ID; });

describe("PayPal Akhiro merchant eligibility", () => {
  it("accepts only products of the configured Akhiro seller", async () => {
    expect(hasOnlyPayPalEligibleSeller([own])).toBe(true);
    await expect(assertPayPalEligibleOrderItems([own])).resolves.toBe(akhiroSellerId);
  });

  it("rejects another seller and a mixed order", async () => {
    expect(hasOnlyPayPalEligibleSeller([other])).toBe(false);
    expect(hasOnlyPayPalEligibleSeller([own, other])).toBe(false);
    await expect(assertPayPalEligibleOrderItems([other])).rejects.toThrow("hanya tersedia");
    await expect(assertPayPalEligibleOrderItems([own, other])).rejects.toThrow("hanya tersedia");
  });

  it("hides PayPal unless every requested checkout product belongs to that seller", async () => {
    mocks.products.mockResolvedValue([{ id: "product-own" }]);
    await expect(canUsePayPalForProductIds(["product-own"])).resolves.toBe(true);
    mocks.products.mockResolvedValue([{ id: "product-own" }]);
    await expect(canUsePayPalForProductIds(["product-own", "product-other"])).resolves.toBe(false);
  });

  it("blocks a direct create, capture, or webhook service bypass for ineligible order items", async () => {
    await expect(assertPayPalOrderEligibility({ items: [other] } as never)).rejects.toThrow("hanya tersedia");
    await expect(assertPayPalOrderEligibility({ items: [own, other] } as never)).rejects.toThrow("hanya tersedia");
  });
});
