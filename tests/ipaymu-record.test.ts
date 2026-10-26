import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    payment: { findUnique: vi.fn(), updateMany: vi.fn() },
    paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { saveIpaymuInvoice } from "../src/lib/payments/ipaymu-record";

const invoice = {
  transactionId: "123",
  referenceId: "order-1",
  bank: "bni",
  bankName: "BNI",
  paymentNo: "0012345",
  amount: 10000,
  fee: 3500,
  total: 13500,
  gatewayExpiry: "2026-10-01 22:00:00",
};

function payment(externalId = "ipaymu_creating:bni:order-1") {
  return {
    id: "payment-1",
    orderId: "order-1",
    provider: "IPAYMU",
    amount: 10000,
    externalId,
    status: "PENDING",
    order: { id: "order-1", total: 10000, status: "PENDING" },
  };
}

function event(saved = invoice) {
  return {
    paymentId: "payment-1",
    eventType: "IPAYMU_VA_CREATED",
    payload: saved,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) =>
      operation(mocks.tx),
  );
  mocks.tx.payment.findUnique.mockResolvedValue(payment());
  mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.paymentEvent.findUnique.mockResolvedValue(null);
  mocks.tx.paymentEvent.create.mockResolvedValue({});
});

describe("iPaymu invoice persistence", () => {
  it("stores the invoice in a serializable transaction", async () => {
    await saveIpaymuInvoice("order-1", "payment-1", invoice);
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function), { isolationLevel: "Serializable" },
    );
    expect(mocks.tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "payment-1",
        provider: "IPAYMU",
        externalId: "ipaymu_creating:bni:order-1",
      },
      data: { externalId: "ipaymu:123" },
    });
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledTimes(1);
  });

  it("accepts a matching invoice already saved by a callback", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(payment("ipaymu:123"));
    mocks.tx.paymentEvent.findUnique.mockResolvedValue(event());
    await saveIpaymuInvoice("order-1", "payment-1", invoice);
    expect(mocks.tx.payment.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
  });

  it("rejects another transaction identity", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(payment("ipaymu:999"));
    await expect(saveIpaymuInvoice(
      "order-1", "payment-1", invoice,
    )).rejects.toThrow();
    expect(mocks.tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an existing invoice with a different payment number", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(payment("ipaymu:123"));
    mocks.tx.paymentEvent.findUnique.mockResolvedValue(
      event({ ...invoice, paymentNo: "999999" }),
    );
    await expect(saveIpaymuInvoice(
      "order-1", "payment-1", invoice,
    )).rejects.toThrow();
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
  });

  it("preserves cancellation when a delayed response arrives", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue({
      ...payment(),
      status: "CANCELLED",
      order: { id: "order-1", total: 10000, status: "CANCELLED" },
    });
    await saveIpaymuInvoice("order-1", "payment-1", invoice);
    const update = mocks.tx.payment.updateMany.mock.calls[0][0];
    expect(update.data).toEqual({ externalId: "ipaymu:123" });
  });

  it("does not create an invoice event when the conditional update fails", async () => {
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveIpaymuInvoice(
      "order-1", "payment-1", invoice,
    )).rejects.toThrow();
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });
    await saveIpaymuInvoice("order-1", "payment-1", invoice);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledTimes(1);
  });

  it("retries a duplicate insert race and accepts the saved invoice", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.tx.payment.findUnique.mockResolvedValue(payment("ipaymu:123"));
    mocks.tx.paymentEvent.findUnique.mockResolvedValue(event());
    await saveIpaymuInvoice("order-1", "payment-1", invoice);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
  });
});
