import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createPayment: vi.fn(),
  db: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    order: { create: vi.fn(), updateMany: vi.fn() },
    payment: { update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/payments/provider", () => ({
  customerPaymentsAvailable: () => true,
  paymentProviderName: () => "sociabuzz",
  getPaymentProvider: () => ({ createPayment: m.createPayment }),
}));

import { createStudioCreditTopUp } from "@/lib/studio/topups";
import { sociaBuzzSessionId } from "@/lib/payments/sociabuzz-client";

describe("Studio top-up payment initialization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const created = { id: "order-1", orderNumber: "KS-TEST-1", customerName: "Buyer", customerEmail: "buyer@example.test", payment: { id: "payment-1" } };
    m.db.$transaction.mockImplementation(async (operation: (tx: typeof m.db) => unknown) => operation(m.db));
    m.db.user.findUnique.mockResolvedValue({ id: "user-1", isActive: true, name: "Buyer", email: "buyer@example.test" });
    m.db.order.create.mockResolvedValue(created);
    m.db.payment.update.mockResolvedValue({});
    m.db.payment.updateMany.mockResolvedValue({ count: 1 });
    m.db.order.updateMany.mockResolvedValue({ count: 1 });
    m.createPayment.mockResolvedValue({ providerTransactionId: `scbz_draft:${sociaBuzzSessionId(created.id)}`, redirectUrl: `/payment/${created.orderNumber}` });
  });

  it("initializes the SociaBuzz draft with the server-only synthetic item", async () => {
    await expect(createStudioCreditTopUp("user-1", "STUDIO_100")).resolves.toEqual({ orderNumber: "KS-TEST-1", redirectUrl: "/payment/KS-TEST-1" });
    expect(m.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 10_000, items: [{ id: "STUDIO_100", name: "100 Studio Credit", price: 10_000, quantity: 1 }] }));
    expect(m.db.payment.update).toHaveBeenCalledWith({ where: { id: "payment-1" }, data: { externalId: `scbz_draft:${sociaBuzzSessionId("order-1")}` } });
  });

  it("fails terminally without credit if the provider session cannot be initialized", async () => {
    m.createPayment.mockRejectedValue(new Error("provider unavailable"));
    await expect(createStudioCreditTopUp("user-1", "STUDIO_100")).rejects.toThrow("provider unavailable");
    expect(m.db.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));
    expect(m.db.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EXPIRED" } }));
  });
});
