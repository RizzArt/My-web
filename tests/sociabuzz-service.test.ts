import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  id: "a".repeat(64),
  db: {
    $transaction: vi.fn(),
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    digitalDelivery: { count: vi.fn() },
    digitalInventory: { updateMany: vi.fn() },
  },
  check: vi.fn(),
  create: vi.fn(),
  deliver: vi.fn(),
  earnings: vi.fn(),
  notify: vi.fn(),
  fulfill: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/delivery/service", () => ({ deliverOrder: mocks.deliver }));
vi.mock("@/lib/payments/paid-order-fulfillment", () => ({ fulfillPaidOrder: mocks.fulfill }));
vi.mock("@/lib/seller-finance", () => ({
  createSellerEarningsForPaidOrder: mocks.earnings,
}));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: mocks.notify }));
vi.mock("@/lib/payments/sociabuzz-client", () => ({
  sociaBuzzSessionId: () => mocks.id,
  checkSociaBuzzPayment: mocks.check,
  createSociaBuzzQr: mocks.create,
}));

import {
  generateSociaBuzzQr,
  verifySociaBuzzOrder,
} from "@/lib/payments/sociabuzz-service";

function fixture() {
  return {
    id: "order-1",
    userId: "buyer-1",
    orderNumber: "KS-TEST-1",
    total: 1000,
    customerName: "Pembeli",
    customerEmail: "buyer@example.com",
    status: "PENDING",
    payment: {
      id: "payment-1",
      amount: 1000,
      provider: "SOCIABUZZ",
      externalId: `scbz:${mocks.id}`,
      status: "PENDING",
    },
  };
}

let order: ReturnType<typeof fixture>;

beforeEach(() => {
  vi.resetAllMocks();
  order = fixture();

  mocks.db.$transaction.mockImplementation(
    async (operation: (tx: typeof mocks.db) => Promise<unknown>) =>
      operation(mocks.db),
  );
  mocks.db.order.findFirst.mockImplementation(async () => order);
  mocks.db.order.findUnique.mockImplementation(async () => order);
  mocks.db.payment.findUnique.mockImplementation(async () => order.payment);

  mocks.db.order.update.mockImplementation(
    async ({ data }: { data: { status: string } }) => {
      order.status = data.status;
      return order;
    },
  );
  mocks.db.payment.updateMany.mockImplementation(
    async ({ data }: { data: { status?: string; externalId?: string } }) => {
      if (data.status) order.payment.status = data.status;
      if (data.externalId) order.payment.externalId = data.externalId;
      return { count: 1 };
    },
  );
  mocks.db.paymentEvent.findUnique.mockResolvedValue({
    paymentId: "payment-1",
    payload: { invoiceId: "TRIBE-IDR-TEST-123" },
  });
  mocks.db.paymentEvent.create.mockResolvedValue({});
  mocks.db.digitalDelivery.count.mockResolvedValue(0);
  mocks.db.digitalInventory.updateMany.mockResolvedValue({ count: 1 });
  mocks.check.mockResolvedValue({
    id: mocks.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount: 1000,
    currency: "IDR",
    invoiceId: "TRIBE-IDR-TEST-123",
    status: "paid",
  });
  mocks.deliver.mockImplementation(async () => {
    order.status = "COMPLETED";
  });
});

describe("SociaBuzz payment settlement", () => {
  it("does not deliver or create earnings for pending payments", async () => {
    mocks.check.mockResolvedValue({
      orderNumber: order.orderNumber,
      amount: 1000,
      invoiceId: "TRIBE-IDR-TEST-123",
      status: "pending",
    });
    await verifySociaBuzzOrder(order.id, order.userId);
    expect(order.payment.status).toBe("PENDING");
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.earnings).not.toHaveBeenCalled();
  });

  it("settles a repeated paid check only once", async () => {
    await verifySociaBuzzOrder(order.id, order.userId);
    await verifySociaBuzzOrder(order.id, order.userId);
    expect(order.payment.status).toBe("PAID");
    expect(mocks.db.paymentEvent.create).toHaveBeenCalledTimes(1);
    expect(mocks.earnings).toHaveBeenCalledTimes(1);
    expect(mocks.fulfill).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("rejects evidence for a different invoice", async () => {
    mocks.check.mockResolvedValue({
      orderNumber: order.orderNumber,
      amount: 1000,
      invoiceId: "TRIBE-IDR-OTHER-456",
      status: "paid",
    });
    await expect(verifySociaBuzzOrder(order.id)).rejects.toThrow();
    expect(mocks.db.payment.updateMany).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("rejects a changed payment amount before settlement", async () => {
    order.payment.amount = 10000;
    await expect(verifySociaBuzzOrder(order.id)).rejects.toThrow();
    expect(mocks.earnings).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("does not reopen cancelled payments", async () => {
    order.payment.status = "CANCELLED";
    order.status = "CANCELLED";
    expect(await verifySociaBuzzOrder(order.id)).toEqual({
      status: "CANCELLED",
    });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("keeps the method locked when QR creation has an uncertain result", async () => {
    order.payment.externalId = `scbz_draft:${mocks.id}`;
    mocks.create.mockRejectedValue(new Error("Gateway timeout"));
    await expect(
      generateSociaBuzzQr(order.id, order.userId),
    ).rejects.toThrow("Gateway timeout");
    expect(order.payment.externalId).toBe(`scbz:${mocks.id}`);
  });
});

describe("SociaBuzz recovery and expiration", () => {
  it("recovers missing metadata and settles a verified payment", async () => {
    mocks.db.paymentEvent.findUnique.mockResolvedValue(null);
    await verifySociaBuzzOrder(order.id);
    expect(mocks.db.paymentEvent.create).toHaveBeenCalledTimes(2);
    expect(order.payment.status).toBe("PAID");
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
  });

  it.each(["expired", "failed"])(
    "releases reserved stock only after verified %s evidence",
    async (status) => {
      mocks.check.mockResolvedValue({
        orderNumber: order.orderNumber,
        amount: 1000,
        currency: "IDR",
        invoiceId: "TRIBE-IDR-TEST-123",
        status,
      });
      await verifySociaBuzzOrder(order.id);
      expect(order.payment.status).toBe(
        status === "expired" ? "EXPIRED" : "FAILED",
      );
      expect(order.status).toBe("EXPIRED");
      expect(mocks.db.digitalInventory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedOrderId: order.id,
            status: "ASSIGNED",
            isSold: false,
          },
        }),
      );
      expect(mocks.deliver).not.toHaveBeenCalled();
      expect(mocks.earnings).not.toHaveBeenCalled();
    },
  );

  it("does not release stock while the provider still says pending", async () => {
    mocks.check.mockResolvedValue({
      orderNumber: order.orderNumber,
      amount: 1000,
      invoiceId: "TRIBE-IDR-TEST-123",
      status: "pending",
      createdAt: 1,
    });
    await verifySociaBuzzOrder(order.id);
    expect(mocks.db.digitalInventory.updateMany).not.toHaveBeenCalled();
  });

  it("blocks expiration cleanup when a delivery references inventory", async () => {
    mocks.db.digitalDelivery.count.mockResolvedValue(1);
    mocks.check.mockResolvedValue({
      orderNumber: order.orderNumber,
      amount: 1000,
      invoiceId: "TRIBE-IDR-TEST-123",
      status: "expired",
    });
    await expect(verifySociaBuzzOrder(order.id)).rejects.toThrow();
    expect(mocks.db.payment.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.digitalInventory.updateMany).not.toHaveBeenCalled();
  });
});

describe("SociaBuzz order ownership", () => {
  it("looks up QR creation by both order ID and user ID", async () => {
    mocks.db.order.findFirst.mockResolvedValue(null);
    await expect(
      generateSociaBuzzQr("order-1", "other-user"),
    ).rejects.toThrow();
    expect(mocks.db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", userId: "other-user" },
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("scopes buyer verification to the authenticated owner", async () => {
    mocks.db.order.findFirst.mockResolvedValue(null);
    await expect(
      verifySociaBuzzOrder("order-1", "other-user"),
    ).rejects.toThrow();
    expect(mocks.db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", userId: "other-user" },
      }),
    );
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
