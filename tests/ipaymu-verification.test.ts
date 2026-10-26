import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: { findFirst: vi.fn(), findUnique: vi.fn() },
    paymentEvent: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    payment: { updateMany: vi.fn(), update: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    walletTransaction: { findUnique: vi.fn(), create: vi.fn() },
    paymentEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  request: vi.fn(),
  config: vi.fn(),
  deliver: vi.fn(),
  earnings: vi.fn(),
  notify: vi.fn(),
  fulfill: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/payments/ipaymu-client", () => ({
  ipaymuConfig: mocks.config, ipaymuRequest: mocks.request,
}));
vi.mock("@/lib/delivery/service", () => ({ deliverOrder: mocks.deliver }));
vi.mock("@/lib/payments/paid-order-fulfillment", () => ({ fulfillPaidOrder: mocks.fulfill }));
vi.mock("@/lib/seller-finance", () => ({
  createSellerEarningsForPaidOrder: mocks.earnings,
}));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: mocks.notify }));

import { verifyIpaymuOrder } from "../src/lib/payments/ipaymu-verification";

function makeOrder() {
  return {
    id: "order-1", userId: "buyer-1", orderNumber: "ORDER-1",
    total: 10000, status: "PENDING",
    payment: {
      id: "payment-1", provider: "IPAYMU", externalId: "ipaymu:123",
      status: "PENDING", amount: 10000, paidAt: null as Date | null,
    },
  };
}
let current = makeOrder();
let balance = 500;
let receipt: { userId: string; amount: number } | null = null;

const invoice = {
  transactionId: "123", referenceId: "order-1",
  bank: "bni", bankName: "BNI", paymentNo: "0012345",
  amount: 10000, fee: 3500, total: 13500, gatewayExpiry: "",
};
const evidence = {
  TransactionId: 123, ReferenceId: "order-1",
  Amount: 10000, Fee: 3500, Status: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  current = makeOrder();
  balance = 500;
  receipt = null;

  mocks.config.mockReturnValue({ mode: "production" });
  mocks.request.mockResolvedValue(evidence);
  mocks.db.order.findFirst.mockImplementation(async () => current);
  mocks.db.order.findUnique.mockImplementation(async () => current);
  mocks.tx.order.findUnique.mockImplementation(async () => current);
  mocks.db.paymentEvent.findUnique.mockImplementation(async (
    query: { where: { provider_providerEventId: { providerEventId: string } } },
  ) => {
    const key = query.where.provider_providerEventId.providerEventId;
    if (key.startsWith("draft:")) {
      return {
        paymentId: "payment-1", eventType: "IPAYMU_VA_DRAFT",
        payload: {
          bank: "bni", bankName: "BNI", fee: 3500,
          feeDirection: "BUYER", mode: "production",
        },
      };
    }
    return {
      paymentId: "payment-1", eventType: "IPAYMU_VA_CREATED",
      payload: invoice,
    };
  });

  mocks.db.$transaction.mockImplementation(async (
    operation: (tx: typeof mocks.tx) => Promise<unknown>,
  ) => operation(mocks.tx));

  mocks.tx.payment.updateMany.mockImplementation(async (
    query: { data: { status: string; paidAt: Date } },
  ) => {
    current.payment.status = query.data.status;
    current.payment.paidAt = query.data.paidAt;
    return { count: 1 };
  });
  mocks.tx.payment.update.mockImplementation(async (
    query: { data: { paidAt: Date } },
  ) => {
    current.payment.paidAt = query.data.paidAt;
    return current.payment;
  });
  mocks.tx.order.update.mockImplementation(async (
    query: { data: { status: string } },
  ) => {
    current.status = query.data.status;
    return current;
  });
  mocks.tx.user.findUniqueOrThrow.mockImplementation(async () => ({ balance }));
  mocks.tx.user.update.mockImplementation(async (
    query: { data: { balance: number } },
  ) => {
    balance = query.data.balance;
    return { balance };
  });
  mocks.tx.walletTransaction.findUnique.mockImplementation(async () => receipt);
  mocks.tx.walletTransaction.create.mockImplementation(async (
    query: { data: { userId: string; amount: number } },
  ) => {
    receipt = query.data;
    return receipt;
  });
});

describe("iPaymu payment verification", () => {
  it("marks a verified payment paid and creates seller earnings once", async () => {
    expect(await verifyIpaymuOrder("order-1")).toEqual({ status: "PAID" });
    expect(current.status).toBe("PAID");
    expect(current.payment.status).toBe("PAID");
    expect(mocks.earnings).toHaveBeenCalledTimes(1);
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
    expect(mocks.tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { isolationLevel: "Serializable" },
    );
  });

  it("does not duplicate earnings for repeated paid callbacks", async () => {
    await verifyIpaymuOrder("order-1");
    await verifyIpaymuOrder("order-1");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.earnings).toHaveBeenCalledTimes(1);
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledTimes(1);
  });

  it("credits only the product price for a late payment", async () => {
    current.status = "CANCELLED";
    current.payment.status = "CANCELLED";
    expect(await verifyIpaymuOrder("order-1")).toEqual({ status: "CANCELLED" });
    expect(balance).toBe(10500);
    expect(receipt?.amount).toBe(10000);
    expect(current.status).toBe("CANCELLED");
    expect(current.payment.status).toBe("CANCELLED");
    expect(mocks.earnings).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("credits a repeated late payment only once", async () => {
    current.status = "CANCELLED";
    current.payment.status = "CANCELLED";
    await verifyIpaymuOrder("order-1");
    await verifyIpaymuOrder("order-1");
    expect(balance).toBe(10500);
    expect(mocks.tx.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does not credit a previously paid cancelled order again", async () => {
    current.status = "CANCELLED";
    current.payment.status = "CANCELLED";
    current.payment.paidAt = new Date();
    await verifyIpaymuOrder("order-1");
    expect(balance).toBe(500);
    expect(mocks.tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it("does not change an unpaid order", async () => {
    mocks.request.mockResolvedValue({ ...evidence, Status: 0 });
    await verifyIpaymuOrder("order-1");
    expect(current.payment.status).toBe("PENDING");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it.each([
    { ReferenceId: "other-order" },
    { TransactionId: 999 },
    { Amount: 1 },
    { Fee: 0 },
  ])("rejects evidence mismatches %j", async (change) => {
    mocks.request.mockResolvedValue({ ...evidence, ...change });
    await expect(verifyIpaymuOrder("order-1")).rejects.toThrow();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(current.payment.status).toBe("PENDING");
    expect(mocks.tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it("retries a transaction conflict without duplicate earnings", async () => {
    mocks.db.$transaction.mockRejectedValueOnce({ code: "P2034" });
    await verifyIpaymuOrder("order-1");
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.earnings).toHaveBeenCalledTimes(1);
  });

  it("retries notification after payment was committed", async () => {
    mocks.notify.mockRejectedValueOnce(new Error("notification unavailable"));
    await expect(verifyIpaymuOrder("order-1")).rejects.toThrow();
    expect(current.payment.status).toBe("PAID");
    await verifyIpaymuOrder("order-1");
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.earnings).toHaveBeenCalledTimes(1);
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
  });
});
