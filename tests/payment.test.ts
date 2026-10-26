import crypto from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { calculateCheckout } from "@/lib/payments/checkout";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { processPaymentWebhook } from "@/lib/payments/fulfillment";

describe("checkout calculation", () => {
  it("calculates totals from backend product prices", () => {
    const result = calculateCheckout([{ id: "p1", name: "Kit", price: 10000 }, { id: "p2", name: "Book", price: 25000 }], { items: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 }] });
    expect(result.subtotal).toBe(45000);
  });
  it("does not accept a client-provided amount", () => {
    const result = calculateCheckout([{ id: "p1", name: "Kit", price: 10000 }], { items: [{ productId: "p1", quantity: 1 }], amount: 1 });
    expect(result.subtotal).toBe(10000);
  });
  it("rejects unavailable products", () => { expect(() => calculateCheckout([{ id: "p1", name: "Kit", price: 10000 }], { items: [{ productId: "p1", quantity: 1 }, { productId: "missing", quantity: 1 }] })).toThrow(); });
});

describe("Midtrans webhook signature", () => {
  beforeEach(() => { process.env.MIDTRANS_SERVER_KEY = "test-server-key"; });
  it("rejects invalid signature", () => { expect(() => new MidtransProvider().handleWebhook(JSON.stringify({ order_id: "KS-1", transaction_id: "tx-1", transaction_status: "settlement", status_code: "200", gross_amount: "10000", signature_key: "bad" }))).toThrow("Invalid Midtrans webhook signature"); });
  it("accepts a valid signature", () => { const body = { order_id: "KS-1", transaction_id: "tx-1", transaction_status: "settlement", status_code: "200", gross_amount: "10000" }; const signature_key = crypto.createHash("sha512").update(`${body.order_id}${body.status_code}${body.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`).digest("hex"); expect(new MidtransProvider().handleWebhook(JSON.stringify({ ...body, signature_key })).status).toBe("PAID"); });
});

function fakeTransaction() {
  const state = { payment: { id: "pay-1", orderId: "ord-1", externalId: "tx-1", status: "PENDING", amount: 10000, paidAt: null as Date | null, order: { id: "ord-1", userId: "user-1", orderNumber: "KS-1", status: "PENDING", items: [{ productId: "p-1", productName: "Kit", quantity: 1 }] } }, inventory: [{ id: "inv-1", productId: "p-1", isSold: false }], events: [] as string[], wallet: [] as Array<{ userId: string; amount: number; referenceType: string; referenceId: string }>, balance: 500, deliveries: [] as string[], orderStatus: "PENDING" };
  const tx = { payment: { findFirst: async () => state.payment, update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(state.payment, data); return state.payment; } }, paymentEvent: { create: async ({ data }: { data: { providerEventId: string } }) => { if (state.events.includes(data.providerEventId)) throw { code: "P2002" }; state.events.push(data.providerEventId); } }, user: { findUniqueOrThrow: async () => ({ balance: state.balance }), update: async ({ data }: { data: { balance: number } }) => { state.balance = data.balance; } }, walletTransaction: { findUnique: async ({ where }: { where: { type_referenceType_referenceId: { referenceType: string; referenceId: string } } }) => state.wallet.find((entry) => entry.referenceType === where.type_referenceType_referenceId.referenceType && entry.referenceId === where.type_referenceType_referenceId.referenceId) ?? null, create: async ({ data }: { data: { userId: string; amount: number; referenceType: string; referenceId: string } }) => { state.wallet.push(data); } }, order: { update: async ({ data }: { data: { status: string } }) => { state.orderStatus = data.status; state.payment.order.status = data.status; } }, digitalInventory: { findFirst: async () => state.inventory.find((item) => !item.isSold), updateMany: async () => { const item = state.inventory.find((candidate) => !candidate.isSold); if (!item) return { count: 0 }; item.isSold = true; return { count: 1 }; } }, digitalDelivery: { create: async ({ data }: { data: { inventoryId: string } }) => { state.deliveries.push(data.inventoryId); } } };
  return { tx, state };
}

describe("payment fulfillment", () => {
  it("processes successful payment and assigns inventory", async () => { const { tx, state } = fakeTransaction(); const event = { provider: "midtrans", providerEventId: "tx-1:settlement:200", providerTransactionId: "tx-1", orderNumber: "KS-1", status: "PAID" as const, amount: 10000, eventType: "settlement", payload: {} }; const result = await processPaymentWebhook(tx as never, event); expect(result.status).toBe("PAID"); expect(state.payment.status).toBe("PAID"); expect(state.orderStatus).toBe("PAID"); expect(state.deliveries).toEqual(["inv-1"]); });
  it("does not process duplicate webhook", async () => { const { tx, state } = fakeTransaction(); const event = { provider: "midtrans", providerEventId: "same-event", providerTransactionId: "tx-1", orderNumber: "KS-1", status: "PAID" as const, amount: 10000, eventType: "settlement", payload: {} }; await processPaymentWebhook(tx as never, event); const result = await processPaymentWebhook(tx as never, event); expect(result.duplicate).toBe(true); expect(state.deliveries).toHaveLength(1); });
  it("records failed payment without delivery", async () => { const { tx, state } = fakeTransaction(); const event = { provider: "midtrans", providerEventId: "tx-1:deny:202", providerTransactionId: "tx-1", orderNumber: "KS-1", status: "FAILED" as const, amount: 10000, eventType: "deny", payload: {} }; const result = await processPaymentWebhook(tx as never, event); expect(result.status).toBe("FAILED"); expect(state.payment.status).toBe("FAILED"); expect(state.deliveries).toHaveLength(0); });
  it("credits a late payment without reopening a cancelled order", async () => { const { tx, state } = fakeTransaction(); state.payment.status = "CANCELLED"; state.payment.order.status = "CANCELLED"; state.orderStatus = "CANCELLED"; const event = { provider: "midtrans", providerEventId: "tx-1:settlement:200", providerTransactionId: "tx-1", orderNumber: "KS-1", status: "PAID" as const, amount: 10000, eventType: "settlement", payload: {} }; const result = await processPaymentWebhook(tx as never, event); expect(result.status).toBe("CANCELLED"); expect(state.payment.status).toBe("CANCELLED"); expect(state.orderStatus).toBe("CANCELLED"); expect(state.balance).toBe(10500); expect(state.wallet).toHaveLength(1); expect(state.deliveries).toHaveLength(0); const duplicate = await processPaymentWebhook(tx as never, { ...event, providerEventId: "tx-1:settlement:201" }); expect(duplicate.status).toBe("CANCELLED"); expect(state.balance).toBe(10500); expect(state.wallet).toHaveLength(1); });
});
