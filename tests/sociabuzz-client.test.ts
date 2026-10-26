import { describe, expect, it } from "vitest";
import {
  sociaBuzzSessionId,
  validateSociaBuzzResponse,
} from "@/lib/payments/sociabuzz-client";
import { SociaBuzzProvider } from "@/lib/payments/sociabuzz";

const order = {
  orderId: "order-test-1",
  orderNumber: "KS-TEST-1",
  amount: 1000,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    id: sociaBuzzSessionId(order.orderId),
    ...order,
    currency: "IDR",
    invoiceId: "TRIBE-IDR-TEST-123",
    method: "qris",
    qrCode: "000201-test",
    totalPay: "1007",
    createdAt: 1790830000000,
    status: "pending",
    ...overrides,
  };
}

describe("SociaBuzz invoice validation", () => {
  it("keeps the order amount separate from the QR payment total", () => {
    const result = validateSociaBuzzResponse(response(), order);
    expect(result.amount).toBe(1000);
    expect(result.totalPay).toBe(1007);
  });

  it.each([
    { id: "a".repeat(64) },
    { orderId: "another-order" },
    { orderNumber: "KS-OTHER" },
    { amount: 10000 },
    { currency: "USD" },
    { invoiceId: "OTHER-PROVIDER" },
    { status: "unknown" },
    { totalPay: "999" },
    { totalPay: "1,007" },
    { totalPay: "1007.5" },
    { qrCode: "" },
  ])("rejects mismatched or invalid payment evidence: %j", (override) => {
    expect(() => validateSociaBuzzResponse(
      response(override), order,
    )).toThrow();
  });

  it("accepts paid only with matching invoice data", () => {
    expect(validateSociaBuzzResponse(
      response({ status: "paid" }), order,
    ).status).toBe("paid");
  });

  it("creates a draft without contacting the gateway", async () => {
    const session = await new SociaBuzzProvider().createPayment({
      ...order,
      customer: { name: "Pembeli", email: "buyer@example.com" },
      items: [],
    });
    expect(session.providerTransactionId).toBe(
      `scbz_draft:${sociaBuzzSessionId(order.orderId)}`,
    );
    expect(session.redirectUrl).toBe("/payment/KS-TEST-1");
  });
});
