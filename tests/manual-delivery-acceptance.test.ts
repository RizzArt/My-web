import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getManualAutoAcceptAt } from "@/lib/delivery/service";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const delivery = readFileSync("src/lib/delivery/service.ts", "utf8");
const endpoint = readFileSync("src/app/api/orders/[orderId]/accept/route.ts", "utf8");
const finance = readFileSync("src/lib/seller-finance.ts", "utf8");

describe("manual delivery acceptance contract", () => {
  it("has separate seller-sent and buyer-accepted fields", () => {
    expect(schema).toContain("AWAITING_CONFIRMATION");
    expect(schema).toContain("sentAt");
    expect(schema).toContain("autoAcceptAt");
    expect(schema).toContain("buyerAcceptedAt");
  });

  it("starts the deadline from seller send time and uses exactly 24 hours", () => {
    const sentAt = new Date("2026-09-28T10:30:00.000Z");
    expect(getManualAutoAcceptAt(sentAt).toISOString()).toBe("2026-09-29T10:30:00.000Z");
    expect(delivery).toContain("status: \"AWAITING_CONFIRMATION\"");
  });

  it("keeps manual earning pending until the shared completion transition", () => {
    expect(delivery).not.toContain("markEarningsEligibleForOrder(tx, delivery.orderId)");
    expect(delivery).toContain("makeManualEarningAvailable");
    expect(finance).toContain('data: { availableAt: new Date() }');
    expect(finance).toContain('type: \"SALE_AVAILABLE\"');
  });

  it("protects the accept endpoint with customer auth and ownership checks", () => {
    expect(endpoint).toContain("session.user.role !== \"CUSTOMER\"");
    expect(endpoint).toContain('source: "BUYER"');
    expect(delivery).toContain("delivery.order.userId !== input.customerId");
    expect(delivery).toContain('delivery.order.status !== "PAID"');
    expect(delivery).toContain('delivery.order.payment?.status !== "PAID"');
  });

  it("uses the same idempotent transition for buyer and auto acceptance", () => {
    expect(delivery).toContain('source: "AUTO"');
    expect(delivery).toContain("buyerAcceptedAt: null");
    expect(delivery).toContain("acceptDueManualDeliveries");
    expect(finance).toContain("sellerWalletTransaction.upsert");
  });

  it("keeps multi-item release scoped to the completed order item", () => {
    expect(delivery).toContain("orderItemId: delivery.orderItemId");
    expect(delivery).toContain("itemComplete");
    expect(delivery).toContain("entityType: \"DigitalDelivery\"");
  });
});
