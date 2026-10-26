import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
import { fulfillStudioCreditTopUp } from "@/lib/studio/topups";

function fixture(status = "PAID", amount = 10_000) {
  const state = { credits: 10, ledger: null as null | { userId: string; type: string; amount: number; balanceBefore: number; balanceAfter: number; topUpId: string; createdAt: Date }, creditedAt: null as Date | null, orderStatus: status };
  const topUp = { id: "topup-1", orderId: "order-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100, order: { userId: "user-1", orderNumber: "KS-1", status, subtotal: 10_000, total: 10_000, payment: { status, amount } } };
  const tx = {
    studioCreditTopUp: { findUnique: vi.fn(async () => topUp), update: vi.fn(async ({ data }) => { state.creditedAt = data.creditedAt; }), updateMany: vi.fn(async ({ data }) => { state.creditedAt ??= data.creditedAt; return { count: 1 }; }) },
    studioCreditTransaction: { findUnique: vi.fn(async () => state.ledger), create: vi.fn(async ({ data }) => { state.ledger = { ...data, createdAt: new Date() }; return state.ledger; }) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ studioCredits: state.credits })), update: vi.fn(async ({ data }) => { state.credits = data.studioCredits; }) },
    order: { update: vi.fn(async () => { state.orderStatus = "COMPLETED"; }), updateMany: vi.fn(async () => { state.orderStatus = "COMPLETED"; return { count: 1 }; }) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { state, tx };
}

describe("Studio Credit top-up fulfillment", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["PENDING", "FAILED", "EXPIRED", "CANCELLED"])("does not credit %s", async (status) => {
    const { state, tx } = fixture(status);
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(fulfillStudioCreditTopUp("order-1")).rejects.toThrow("Data top up tidak konsisten");
    expect(state.credits).toBe(10); expect(state.ledger).toBeNull();
  });
  it("credits exactly once with a balanced TOPUP_PURCHASE ledger", async () => {
    const { state, tx } = fixture(); m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(fulfillStudioCreditTopUp("order-1")).resolves.toMatchObject({ duplicate: false });
    await expect(fulfillStudioCreditTopUp("order-1")).resolves.toMatchObject({ duplicate: true });
    expect(state.credits).toBe(110); expect(state.ledger).toMatchObject({ type: "TOPUP_PURCHASE", amount: 100, balanceBefore: 10, balanceAfter: 110, topUpId: "topup-1" }); expect(state.creditedAt).not.toBeNull();
  });
  it("retries a serializable conflict and observes the existing ledger", async () => {
    const { state, tx } = fixture(); let calls = 0;
    m.db.$transaction.mockImplementation(async (work) => { calls += 1; if (calls === 1) throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }); return work(tx); });
    // The competing serializable transaction has committed both balance and ledger.
    state.credits = 110;
    state.ledger = { userId: "user-1", type: "TOPUP_PURCHASE", amount: 100, balanceBefore: 10, balanceAfter: 110, topUpId: "topup-1", createdAt: new Date() };
    await expect(fulfillStudioCreditTopUp("order-1")).resolves.toMatchObject({ duplicate: true });
    expect(state.credits).toBe(110); expect(calls).toBe(2);
  });
  it("retries a unique-ledger conflict after the competing transaction commits", async () => {
    const { state, tx } = fixture(); let calls = 0;
    m.db.$transaction.mockImplementation(async (work) => {
      calls += 1;
      if (calls === 1) {
        // This represents a competing transaction that committed the user update and unique topUpId ledger.
        state.credits = 110;
        state.ledger = { userId: "user-1", type: "TOPUP_PURCHASE", amount: 100, balanceBefore: 10, balanceAfter: 110, topUpId: "topup-1", createdAt: new Date() };
        throw new Prisma.PrismaClientKnownRequestError("duplicate ledger", { code: "P2002", clientVersion: "test" });
      }
      return work(tx);
    });
    await expect(fulfillStudioCreditTopUp("order-1")).resolves.toMatchObject({ duplicate: true });
    expect(state.credits).toBe(110); expect(state.ledger).not.toBeNull(); expect(calls).toBe(2);
  });
  it("fails closed on payment amount or ownership mismatch", async () => {
    const wrongAmount = fixture("PAID", 9_999); m.db.$transaction.mockImplementation(async (work) => work(wrongAmount.tx));
    await expect(fulfillStudioCreditTopUp("order-1")).rejects.toThrow("Data top up tidak konsisten"); expect(wrongAmount.state.credits).toBe(10);
    const ownership = fixture(); ownership.tx.studioCreditTopUp.findUnique.mockResolvedValueOnce({ ...await ownership.tx.studioCreditTopUp.findUnique(), userId: "user-2" }); m.db.$transaction.mockImplementation(async (work) => work(ownership.tx));
    await expect(fulfillStudioCreditTopUp("order-1")).rejects.toThrow("Data top up tidak konsisten"); expect(ownership.state.credits).toBe(10);
  });
});
