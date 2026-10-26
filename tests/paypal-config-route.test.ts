import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  order: vi.fn(),
  publicConfig: vi.fn(),
  eligibleItems: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: mocks.order } } }));
vi.mock("@/lib/payments/paypal", () => ({ paypalPublicConfig: mocks.publicConfig }));
vi.mock("@/lib/payments/paypal-eligibility", () => ({ assertPayPalEligibleOrderItems: mocks.eligibleItems }));

import { GET } from "@/app/api/orders/[orderId]/paypal/config/route";

const akhiroSellerId = "cmuked1p60007boedzz75hylp";
const akhiroItem = { product: { sellerId: akhiroSellerId } };
const otherSellerItem = { product: { sellerId: "seller-other-456" } };
const context = { params: Promise.resolve({ orderId: "order-1" }) };

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "buyer-1" } });
  mocks.order.mockReset().mockResolvedValue({ payment: { provider: "PAYPAL" }, items: [akhiroItem] });
  mocks.publicConfig.mockReset().mockReturnValue({ enabled: true, clientId: "public-client", currency: "USD" });
  mocks.eligibleItems.mockReset().mockResolvedValue(akhiroSellerId);
});

describe("PayPal order configuration route", () => {
  it("returns the runtime PayPal configuration only for an Akhiro order", async () => {
    const response = await GET(new Request("http://localhost/api/orders/order-1/paypal/config"), context);

    expect(await response.json()).toEqual({ paypal: { enabled: true, clientId: "public-client", currency: "USD" } });
    expect(mocks.order).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order-1", userId: "buyer-1" } }));
    expect(mocks.eligibleItems).toHaveBeenCalledWith([akhiroItem]);
  });

  it("does not expose PayPal configuration for another seller's item", async () => {
    mocks.order.mockResolvedValue({ payment: { provider: "PAYPAL" }, items: [otherSellerItem] });
    mocks.eligibleItems.mockRejectedValue(new Error("PayPal hanya tersedia untuk produk seller merchant yang dikonfigurasi."));

    const response = await GET(new Request("http://localhost/api/orders/order-1/paypal/config"), context);

    expect(await response.json()).toEqual({ paypal: { enabled: false } });
    expect(mocks.publicConfig).not.toHaveBeenCalled();
  });
});
