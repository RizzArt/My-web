import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fulfill: vi.fn(), db: { $transaction: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/payments/paid-order-fulfillment", () => ({ fulfillPaidOrder: m.fulfill }));
vi.mock("@/lib/payments/sociabuzz-guard", () => ({ assertSociaBuzzAlternativeAllowed: vi.fn() }));
vi.mock("@/lib/payments/ipaymu-guard", () => ({ assertIpaymuAlternativeAllowed: vi.fn() }));
import { payOrderWithBalance } from "@/lib/customer-wallet";

describe("Studio top-up wallet payment", () => {
  beforeEach(() => vi.resetAllMocks());

  it("validates the server snapshot before one wallet debit and dispatches once", async () => {
    const state = { balance: 20_000, wallet: 0, status: "PENDING", order: "PENDING" };
    const topUp = { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100 };
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 10_000, total: 10_000, status: "PENDING", createdAt: new Date(), payment: { id: "pay-1", status: "PENDING", amount: 10_000, provider: "SOCIABUZZ" }, studioCreditTopUp: topUp };
    const tx = { order: { findFirst: vi.fn(async () => order), update: vi.fn(async () => { state.order = "PAID"; order.status = "PAID"; }) }, user: { findUniqueOrThrow: vi.fn(async () => ({ balance: state.balance, isActive: true })), update: vi.fn(async ({ data }) => { state.balance = data.balance; }) }, walletTransaction: { create: vi.fn(async () => { state.wallet += 1; }) }, payment: { update: vi.fn(async ({ data }) => { state.status = data.status; order.payment = { ...order.payment, ...data }; }) }, studioCreditTransaction: { findUnique: vi.fn(async () => null) } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await payOrderWithBalance("order-1", "user-1");
    expect(state).toMatchObject({ balance: 10_000, wallet: 1, status: "PAID", order: "PAID" });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: -10_000, balanceBefore: 20_000, balanceAfter: 10_000, referenceId: "order-1" }) }));
    expect(m.fulfill).toHaveBeenCalledWith("order-1");
  });
  it("rejects a tampered snapshot before debit", async () => {
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 9_999, total: 10_000, status: "PENDING", createdAt: new Date(), payment: { id: "pay-1", status: "PENDING", amount: 10_000, provider: "SOCIABUZZ" }, studioCreditTopUp: { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100 } };
    const tx = { order: { findFirst: vi.fn(async () => order) }, studioCreditTransaction: { findUnique: vi.fn() }, user: { findUniqueOrThrow: vi.fn() }, walletTransaction: { create: vi.fn() }, payment: { update: vi.fn() } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-1", "user-1")).rejects.toThrow("Data top up tidak konsisten");
    expect(tx.user.findUniqueOrThrow).not.toHaveBeenCalled(); expect(tx.walletTransaction.create).not.toHaveBeenCalled(); expect(m.fulfill).not.toHaveBeenCalled();
  });

  it("does not debit again and dispatches recovery when payment is already paid", async () => {
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 10_000, total: 10_000, status: "PAID", createdAt: new Date("2020-01-01"), payment: { id: "pay-1", status: "PAID", amount: 10_000, provider: "WALLET" }, studioCreditTopUp: { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100 } };
    const tx = { order: { findFirst: vi.fn(async () => order) }, studioCreditTransaction: { findUnique: vi.fn() }, user: { findUniqueOrThrow: vi.fn(), update: vi.fn() }, walletTransaction: { create: vi.fn() }, payment: { update: vi.fn() } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-1", "user-1")).resolves.toEqual({ orderId: "order-1" });
    expect(tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(m.fulfill).toHaveBeenCalledTimes(1);
    expect(m.fulfill).toHaveBeenCalledWith("order-1");
  });

  it.each([
    ["package", { packageCode: "NOT_ALLOWED" }],
    ["name", { packageName: "99 Studio Credit" }],
    ["price", { price: 9_999 }],
    ["credits", { credits: 99 }],
    ["owner", { userId: "user-2" }],
  ])("rejects a %s snapshot mismatch without financial side effects", async (_case, override) => {
    const topUp = { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100, ...override };
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 10_000, total: 10_000, status: "PENDING", createdAt: new Date(), payment: { id: "pay-1", status: "PENDING", amount: 10_000, provider: "SOCIABUZZ" }, studioCreditTopUp: topUp };
    const tx = { order: { findFirst: vi.fn(async () => order) }, studioCreditTransaction: { findUnique: vi.fn() }, user: { findUniqueOrThrow: vi.fn(), update: vi.fn() }, walletTransaction: { create: vi.fn() }, payment: { update: vi.fn() } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-1", "user-1")).rejects.toThrow("Data top up tidak konsisten");
    expect(tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(m.fulfill).not.toHaveBeenCalled();
  });

  it.each([
    ["expired order", "EXPIRED", "PENDING"],
    ["failed payment", "PENDING", "FAILED"],
    ["cancelled payment", "PENDING", "CANCELLED"],
  ])("does not debit a %s", async (_case, orderStatus, paymentStatus) => {
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 10_000, total: 10_000, status: orderStatus, createdAt: new Date(), payment: { id: "pay-1", status: paymentStatus, amount: 10_000, provider: "SOCIABUZZ" }, studioCreditTopUp: { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100 } };
    const tx = { order: { findFirst: vi.fn(async () => order) }, studioCreditTransaction: { findUnique: vi.fn() }, user: { findUniqueOrThrow: vi.fn(), update: vi.fn() }, walletTransaction: { create: vi.fn() }, payment: { update: vi.fn() } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-1", "user-1")).rejects.toThrow();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(m.fulfill).not.toHaveBeenCalled();
  });

  it.each([
    ["insufficient balance", { balance: 9_999, isActive: true }, "Saldo Akun tidak mencukupi."],
    ["inactive user", { balance: 20_000, isActive: false }, "Akun tidak aktif."],
  ])("does not debit when there is %s", async (_case, user, message) => {
    const order = { id: "order-1", userId: "user-1", orderNumber: "KS-1", subtotal: 10_000, total: 10_000, status: "PENDING", createdAt: new Date(), payment: { id: "pay-1", status: "PENDING", amount: 10_000, provider: "SOCIABUZZ" }, studioCreditTopUp: { id: "topup-1", userId: "user-1", packageCode: "STUDIO_100", packageName: "100 Studio Credit", price: 10_000, credits: 100 } };
    const tx = { order: { findFirst: vi.fn(async () => order) }, studioCreditTransaction: { findUnique: vi.fn(async () => null) }, user: { findUniqueOrThrow: vi.fn(async () => user), update: vi.fn() }, walletTransaction: { create: vi.fn() }, payment: { update: vi.fn() } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-1", "user-1")).rejects.toThrow(message);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(m.fulfill).not.toHaveBeenCalled();
  });

  it("does not expose another user's order to the wallet path", async () => {
    const tx = { order: { findFirst: vi.fn(async () => null) } };
    m.db.$transaction.mockImplementation(async (work) => work(tx));
    await expect(payOrderWithBalance("order-owned-by-user-2", "user-1")).rejects.toThrow("Pesanan tidak ditemukan.");
    expect(m.fulfill).not.toHaveBeenCalled();
  });
});
