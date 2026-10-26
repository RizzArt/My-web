import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/payments/paypal-service.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../src/app/api/webhooks/paypal/route.ts", import.meta.url), "utf8");

describe("PayPal duplicate and webhook guards", () => {
  it("uses unique capture and provider-event identities before fulfillment", () => {
    expect(schema).toContain("captureId          String?              @unique");
    expect(schema).toContain("@@unique([provider, providerEventId])");
    expect(service).toContain("providerEventId: eventId");
    expect(service).toContain('status: "PAID", paidAt: new Date()');
    expect(service).toContain("createSellerEarningsForPaidOrder(tx, order.id)");
  });

  it("verifies the signed webhook and retrieves the PayPal order before capture processing", () => {
    expect(webhook).toContain("verifyPayPalWebhook");
    expect(webhook).toContain("processPayPalWebhook");
    expect(service).toContain("getPayPalOrder(paypalOrderId)");
    expect(service).toContain("validatePayPalCapture");
  });
});
