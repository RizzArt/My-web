import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  tx: {} as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
  db: { $transaction: vi.fn(), refundRequest: { findUnique: vi.fn() } },
  notifyAdmins: vi.fn(),
  adminNotifiedTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/admin-notifications", () => ({
  notifyAdmins: m.notifyAdmins,
  adminNotifiedTransaction: m.adminNotifiedTransaction,
}));
vi.mock("@/lib/seller-finance", () => ({ reverseOrderEarnings: vi.fn() }));

import {
  approveRefund,
  createRefundRequest,
  markRefunded,
  reconcileRefundSellerEarnings,
  StudioTopUpRefundBlocked,
  StudioTopUpRefundReviewRequired,
} from "@/lib/refunds";

function creditedTopUpTx(creditedAt: Date | null = new Date()) {
  const state = { reviewAt: null as Date | null, reviewReason: null as string | null, audits: 0, refunds: 0 };
  const topUp = { id: "topup-1", creditedAt };
  const order = { id: "order-1", status: "COMPLETED", total: 10_000, completedAt: new Date(), refundRequest: null, studioCreditTopUp: topUp };
  const tx = {
    order: { findFirst: vi.fn(async () => order) },
    studioCreditTopUp: {
      findUnique: vi.fn(async () => ({ id: topUp.id, creditedAt: state.reviewAt ?? topUp.creditedAt })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (!topUp.creditedAt || state.reviewAt || where.refundReviewAt !== null) return { count: 0 };
        state.reviewAt = data.refundReviewAt;
        state.reviewReason = data.refundReviewReason;
        return { count: 1 };
      }),
    },
    auditLog: { create: vi.fn(async () => { state.audits += 1; }) },
    refundRequest: { create: vi.fn(async () => { state.refunds += 1; return { id: "refund-1" }; }) },
  };
  return { state, tx, order };
}

describe("Studio top-up refund service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.adminNotifiedTransaction.mockImplementation(async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx));
    m.db.$transaction.mockImplementation(async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx));
  });

  it("blocks a credited top-up, persists one review audit, and uses a stable notification key", async () => {
    const { state, tx } = creditedTopUpTx();
    m.tx = tx as never;
    await expect(createRefundRequest({ orderId: "order-1", userId: "user-1", method: "ACCOUNT_BALANCE", reason: "Tidak jadi" })).rejects.toBeInstanceOf(StudioTopUpRefundReviewRequired);
    await expect(createRefundRequest({ orderId: "order-1", userId: "user-1", method: "ACCOUNT_BALANCE", reason: "Tidak jadi" })).rejects.toBeInstanceOf(StudioTopUpRefundReviewRequired);
    expect(state.refunds).toBe(0);
    expect(state.reviewAt).toBeInstanceOf(Date);
    expect(state.reviewReason).toBe("CUSTOMER_REFUND_REQUEST");
    expect(state.audits).toBe(1);
    expect(m.notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ eventKey: "studio-topup-refund-review:topup-1" }));
    expect(m.notifyAdmins).toHaveBeenCalledTimes(2);
  });

  it("blocks an uncredited top-up without creating a false review, refund, or audit", async () => {
    const { state, tx } = creditedTopUpTx(null);
    m.tx = tx as never;
    await expect(createRefundRequest({ orderId: "order-1", userId: "user-1", method: "ACCOUNT_BALANCE", reason: "Tidak jadi" })).rejects.toBeInstanceOf(StudioTopUpRefundBlocked);
    expect(state.refunds).toBe(0);
    expect(state.reviewAt).toBeNull();
    expect(state.audits).toBe(0);
    expect(m.notifyAdmins).not.toHaveBeenCalled();
  });

  it("leaves a normal product order on the existing refund-request path", async () => {
    const refund = { id: "refund-product" };
    m.tx = {
      order: { findFirst: vi.fn(async () => ({ id: "order-product", status: "COMPLETED", total: 12_000, completedAt: new Date(), refundRequest: null, studioCreditTopUp: null })) },
      refundRequest: { create: vi.fn(async () => refund) },
    } as never;
    await expect(createRefundRequest({ orderId: "order-product", userId: "user-1", method: "ACCOUNT_BALANCE", reason: "Produk rusak" })).resolves.toEqual(refund);
    expect(m.tx.refundRequest.create).toHaveBeenCalledTimes(1);
    expect(m.notifyAdmins).not.toHaveBeenCalled();
  });

  it("fails closed on all legacy admin refund actions for a credited top-up", async () => {
    const { state, tx } = creditedTopUpTx();
    m.tx = tx as never;
    m.db.refundRequest.findUnique.mockResolvedValue({ orderId: "order-1", order: { studioCreditTopUp: { id: "topup-1" } } });
    await expect(approveRefund("refund-1", "admin-1")).rejects.toBeInstanceOf(StudioTopUpRefundReviewRequired);
    await expect(markRefunded("refund-1")).rejects.toBeInstanceOf(StudioTopUpRefundReviewRequired);
    await expect(reconcileRefundSellerEarnings("refund-1")).rejects.toBeInstanceOf(StudioTopUpRefundReviewRequired);
    expect(state.audits).toBe(1);
    expect(m.notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ eventKey: "studio-topup-refund-review:topup-1" }));
  });
});
