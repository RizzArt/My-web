import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  id: "a".repeat(64),
  db: {
    $transaction: vi.fn(),
    order: {
      findFirst: vi.fn(), findUnique: vi.fn(),
      updateMany: vi.fn(), update: vi.fn(),
    },
    payment: { findUnique: vi.fn(), updateMany: vi.fn() },
    paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
    digitalDelivery: { count: vi.fn() },
    digitalInventory: { updateMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    walletTransaction: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  check: vi.fn(), create: vi.fn(), notify: vi.fn(),
  deliver: vi.fn(), earnings: vi.fn(), reverse: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/admin-notifications", () => ({
  notifyAdmins: m.notify,
  adminNotifiedTransaction: vi.fn(),
}));
vi.mock("@/lib/delivery/service", () => ({ deliverOrder: m.deliver }));
vi.mock("@/lib/seller-finance", () => ({
  createSellerEarningsForPaidOrder: m.earnings,
  reverseOrderEarnings: m.reverse,
}));
vi.mock("@/lib/payments/sociabuzz-client", () => ({
  sociaBuzzSessionId: () => m.id,
  checkSociaBuzzPayment: m.check,
  createSociaBuzzQr: m.create,
}));

import { cancelUnpaidOrder } from "@/lib/customer-cancellation";
import { verifySociaBuzzOrder } from "@/lib/payments/sociabuzz-service";

type StoredEvent = {
  id: string; paymentId: string; eventType: string;
  providerEventId: string; payload: Record<string, unknown>;
};
type Ledger = {
  userId: string; amount: number; referenceId: string;
  referenceType: string; balanceBefore: number; balanceAfter: number;
};

function fixture() {
  return {
    order: {
      id: "order-1", userId: "buyer-1", orderNumber: "KS-TEST-1",
      total: 1000, status: "PENDING", deliveries: [],
      customerName: "Pembeli", customerEmail: "buyer@example.com",
      payment: {
        id: "payment-1", amount: 1000, provider: "SOCIABUZZ",
        externalId: `scbz:${m.id}`, status: "PENDING",
        paidAt: null as Date | null,
      },
    },
    balance: 500,
    inventory: "ASSIGNED",
    events: new Map<string, StoredEvent>(),
    ledger: [] as Ledger[],
  };
}
let state = fixture();

function evidence(status = "paid") {
  return {
    id: m.id, orderId: "order-1", orderNumber: "KS-TEST-1",
    amount: 1000, currency: "IDR",
    invoiceId: "TRIBE-IDR-TEST-123", status,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  state = fixture();

  m.db.$transaction.mockImplementation(async (
    operation: (tx: typeof m.db) => Promise<unknown>,
  ) => {
    const snapshot = structuredClone(state);
    try { return await operation(m.db); }
    catch (error) { state = snapshot; throw error; }
  });
  m.db.order.findFirst.mockImplementation(async (
    args: { where: { id: string; userId?: string } },
  ) => {
    if (args.where.id !== state.order.id) return null;
    if (args.where.userId && args.where.userId !== state.order.userId) return null;
    return structuredClone(state.order);
  });
  m.db.order.findUnique.mockImplementation(async () => structuredClone(state.order));
  m.db.payment.findUnique.mockImplementation(async () => state.order.payment);
  m.db.order.updateMany.mockImplementation(async (
    args: { data: { status: string } },
  ) => {
    state.order.status = args.data.status;
    return { count: 1 };
  });
  m.db.order.update.mockImplementation(async (
    args: { data: { status: string } },
  ) => {
    state.order.status = args.data.status;
    return state.order;
  });
  m.db.payment.updateMany.mockImplementation(async (
    args: { data: { status?: string; paidAt?: Date } },
  ) => {
    if (args.data.status) state.order.payment.status = args.data.status;
    if (args.data.paidAt) state.order.payment.paidAt = args.data.paidAt;
    return { count: 1 };
  });
  m.db.paymentEvent.findUnique.mockImplementation(async (
    args: { where: { provider_providerEventId: { providerEventId: string } } },
  ) => state.events.get(args.where.provider_providerEventId.providerEventId) ?? null);
  m.db.paymentEvent.create.mockImplementation(async (
    args: { data: Omit<StoredEvent, "id"> },
  ) => {
    if (state.events.has(args.data.providerEventId)) throw new Error("duplicate event");
    const stored = { id: `event-${args.data.providerEventId}`, ...args.data };
    state.events.set(stored.providerEventId, stored);
    return stored;
  });
  m.db.digitalDelivery.count.mockResolvedValue(0);
  m.db.digitalInventory.updateMany.mockImplementation(async () => {
    state.inventory = "AVAILABLE";
    return { count: 1 };
  });
  m.db.user.findUniqueOrThrow.mockImplementation(async () => ({ balance: state.balance }));
  m.db.user.update.mockImplementation(async (
    args: { data: { balance: number } },
  ) => { state.balance = args.data.balance; return { balance: state.balance }; });
  m.db.walletTransaction.findUnique.mockImplementation(async () => state.ledger[0] ?? null);
  m.db.walletTransaction.create.mockImplementation(async (
    args: { data: Ledger },
  ) => { state.ledger.push(args.data); return args.data; });
  m.check.mockResolvedValue(evidence());
  m.notify.mockResolvedValue(undefined);
});

describe("SociaBuzz cancellation and late payment", () => {
  it("cancels an owned pending invoice and releases only unsold assigned stock", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    expect(state.order.status).toBe("CANCELLED");
    expect(state.order.payment.status).toBe("CANCELLED");
    expect(state.inventory).toBe("AVAILABLE");
    expect(state.events.get(`cancel:${m.id}`)?.eventType)
      .toBe("SOCIABUZZ_CANCELLED_MONITORING");
    const paymentUpdate = m.db.payment.updateMany.mock.calls.find(([args]) =>
      args.data.lateMonitoringStartedAt,
    )?.[0];
    expect(paymentUpdate?.data.lateMonitoringStartedAt).toBeInstanceOf(Date);
    expect(paymentUpdate?.data.lateLastCheckedAt).toBeNull();
    expect(m.db.digitalInventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedOrderId: "order-1", status: "ASSIGNED", isSold: false },
      }),
    );
    expect(state.ledger).toHaveLength(0);
  });

  it("rejects another account's cancellation", async () => {
    await expect(cancelUnpaidOrder("order-1", "other-user")).rejects.toThrow();
    expect(m.db.order.updateMany).not.toHaveBeenCalled();
    expect(state.inventory).toBe("ASSIGNED");
  });

  it("does not release stock referenced by a delivery", async () => {
    m.db.digitalDelivery.count.mockResolvedValue(1);
    await expect(cancelUnpaidOrder("order-1", "buyer-1")).rejects.toThrow();
    expect(state.order.status).toBe("PENDING");
    expect(state.inventory).toBe("ASSIGNED");
  });

  it("rolls back cancellation when the payment claim fails", async () => {
    m.db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(cancelUnpaidOrder("order-1", "buyer-1")).rejects.toThrow();
    expect(state.order.status).toBe("PENDING");
    expect(state.events.size).toBe(0);
    expect(state.inventory).toBe("ASSIGNED");
  });

  it("rejects cancellation after payment has been processed", async () => {
    state.order.payment.status = "PAID";
    await expect(cancelUnpaidOrder("order-1", "buyer-1")).rejects.toThrow();
    expect(m.db.digitalInventory.updateMany).not.toHaveBeenCalled();
  });

  it("keeps pending cancelled invoices under observation without credit", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    m.check.mockResolvedValue(evidence("pending"));
    await verifySociaBuzzOrder("order-1");
    expect(state.balance).toBe(500);
    expect(state.ledger).toHaveLength(0);
    expect(state.order.payment.paidAt).toBeNull();
  });

  it("credits a late payment exactly once and never delivers or creates seller earnings", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    await verifySociaBuzzOrder("order-1");
    await verifySociaBuzzOrder("order-1");
    expect(state.balance).toBe(1500);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      userId: "buyer-1", amount: 1000,
      referenceType: "SociaBuzzLatePayment", referenceId: "payment-1",
    });
    expect(state.order.status).toBe("CANCELLED");
    expect(state.order.payment.status).toBe("CANCELLED");
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.deliver).not.toHaveBeenCalled();
    expect(m.earnings).not.toHaveBeenCalled();
  });

  it("keeps the monitoring start immutable during repeated reconciliation", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    const startedAt = m.db.payment.updateMany.mock.calls.find(([args]) =>
      args.data.lateMonitoringStartedAt,
    )?.[0].data.lateMonitoringStartedAt;
    await verifySociaBuzzOrder("order-1");
    expect(m.db.payment.updateMany.mock.calls.filter(([args]) =>
      args.data.lateMonitoringStartedAt,
    )).toHaveLength(1);
    expect(startedAt).toBeInstanceOf(Date);
  });

  it("retries a failed notification using the committed credit receipt", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    m.notify.mockRejectedValueOnce(new Error("notification unavailable"));
    await expect(verifySociaBuzzOrder("order-1")).rejects.toThrow();
    expect(state.balance).toBe(1500);
    expect(state.order.payment.paidAt).toBeNull();
    m.check.mockRejectedValue(new Error("gateway unavailable"));
    await verifySociaBuzzOrder("order-1");
    expect(state.balance).toBe(1500);
    expect(state.ledger).toHaveLength(1);
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(state.order.payment.paidAt).not.toBeNull();
  });

  it("rejects an invoice that differs from the original QR record", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    state.events.set(`qr:${m.id}`, {
      id: "qr-event", paymentId: "payment-1", eventType: "QR_CREATED",
      providerEventId: `qr:${m.id}`, payload: { invoiceId: "TRIBE-IDR-OTHER-456" },
    });
    await expect(verifySociaBuzzOrder("order-1")).rejects.toThrow();
    expect(state.balance).toBe(500);
    expect(state.ledger).toHaveLength(0);
  });

  it("rejects incorrect payment amounts", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    m.check.mockResolvedValue({ ...evidence(), amount: 2000 });
    await expect(verifySociaBuzzOrder("order-1")).rejects.toThrow();
    expect(state.balance).toBe(500);
    expect(state.ledger).toHaveLength(0);
  });

  it("handles cancellation during a paid status request on the next worker pass", async () => {
    m.check.mockImplementationOnce(async () => {
      await cancelUnpaidOrder("order-1", "buyer-1");
      return evidence();
    });
    await expect(verifySociaBuzzOrder("order-1")).rejects.toThrow();
    expect(m.deliver).not.toHaveBeenCalled();
    await verifySociaBuzzOrder("order-1");
    expect(state.balance).toBe(1500);
    expect(state.ledger).toHaveLength(1);
    expect(m.earnings).not.toHaveBeenCalled();
  });

  it("rejects verification by another account", async () => {
    await cancelUnpaidOrder("order-1", "buyer-1");
    await expect(verifySociaBuzzOrder("order-1", "other-user")).rejects.toThrow();
    expect(m.check).not.toHaveBeenCalled();
    expect(state.ledger).toHaveLength(0);
  });

  it("does not credit an unmarked legacy cancellation", async () => {
    state.order.status = "CANCELLED";
    state.order.payment.status = "CANCELLED";
    await verifySociaBuzzOrder("order-1");
    expect(m.check).not.toHaveBeenCalled();
    expect(state.balance).toBe(500);
  });
});
