import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { processPaymentWebhook } from "@/lib/payments/fulfillment";

function fixture() {
  const topUp = { id: "topup-1", creditedAt: new Date(), refundReviewAt: null as Date | null };
  const state = {
    paymentStatus: "PAID",
    orderStatus: "COMPLETED",
    events: [] as string[],
    audits: 0,
    walletRefunds: 0,
    credits: 110,
    ledgers: 1,
  };
  const payment = {
    id: "payment-1", orderId: "order-1", externalId: "provider-1", amount: 10_000, status: "PAID",
    order: { id: "order-1", userId: "user-1", orderNumber: "KS-1", status: "COMPLETED", items: [], studioCreditTopUp: topUp },
  };
  const tx = {
    payment: {
      findFirst: async () => payment,
      update: async ({ data }: { data: { status: string } }) => { state.paymentStatus = data.status; payment.status = data.status; },
    },
    paymentEvent: {
      create: async ({ data }: { data: { providerEventId: string } }) => {
        if (state.events.includes(data.providerEventId)) {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
        }
        state.events.push(data.providerEventId);
      },
    },
    studioCreditTopUp: {
      findUnique: async () => ({ id: topUp.id, creditedAt: topUp.creditedAt }),
      updateMany: async () => {
        if (topUp.refundReviewAt) return { count: 0 };
        topUp.refundReviewAt = new Date();
        return { count: 1 };
      },
    },
    auditLog: { create: async () => { state.audits += 1; } },
    order: { update: async () => { state.orderStatus = "CANCELLED"; } },
    sellerEarning: { findMany: async () => [] },
    walletTransaction: { create: async () => { state.walletRefunds += 1; } },
  };
  return { state, topUp, payment, tx };
}

const event = {
  provider: "midtrans", providerEventId: "refund-1", providerTransactionId: "provider-1", orderNumber: "KS-1",
  status: "REFUNDED" as const, amount: 10_000, eventType: "refund", payload: {},
};

describe("generic refunded Studio top-up webhook", () => {
  it("records provider REFUNDED and a durable review without touching credit or order fulfillment", async () => {
    const { state, topUp, tx } = fixture();
    await expect(processPaymentWebhook(tx as never, event)).resolves.toMatchObject({ duplicate: false, status: "REFUNDED", reviewTopUpId: "topup-1" });
    expect(state.paymentStatus).toBe("REFUNDED");
    expect(state.orderStatus).toBe("COMPLETED");
    expect(topUp.refundReviewAt).toBeInstanceOf(Date);
    expect(state.audits).toBe(1);
    expect(state.credits).toBe(110);
    expect(state.ledgers).toBe(1);
    expect(state.walletRefunds).toBe(0);
  });

  it("returns review identity for a duplicate event without another mutation", async () => {
    const { state, tx } = fixture();
    await processPaymentWebhook(tx as never, event);
    await expect(processPaymentWebhook(tx as never, event)).resolves.toMatchObject({ duplicate: true, status: "REFUNDED", reviewTopUpId: "topup-1" });
    expect(state.audits).toBe(1);
    expect(state.walletRefunds).toBe(0);
    expect(state.credits).toBe(110);
    expect(state.ledgers).toBe(1);
  });

  it.each([
    ["amount", { amount: 9_999 }],
    ["order", { orderNumber: "KS-other" }],
    ["transaction", { providerTransactionId: "other-provider" }],
  ])("fails closed for a mismatched %s", async (_case, override) => {
    const { state, topUp, tx } = fixture();
    await expect(processPaymentWebhook(tx as never, { ...event, ...override })).rejects.toThrow();
    expect(state.paymentStatus).toBe("PAID");
    expect(topUp.refundReviewAt).toBeNull();
    expect(state.audits).toBe(0);
    expect(state.walletRefunds).toBe(0);
  });
});
