import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getUnpaidOrderDeadline, isUnpaidOrderExpired } from "@/lib/order-expiry";


const timeoutMocks = vi.hoisted(() => ({
  cancel: vi.fn(), sociaBuzz: vi.fn(), ipaymu: vi.fn(), deliver: vi.fn(),
}));
vi.mock("@/lib/customer-cancellation", () => ({
  autoCancelExpiredOrder: timeoutMocks.cancel,
}));
vi.mock("@/lib/payments/sociabuzz-service", () => ({
  verifySociaBuzzOrder: timeoutMocks.sociaBuzz,
}));
vi.mock("@/lib/payments/ipaymu-verification", () => ({
  verifyIpaymuOrder: timeoutMocks.ipaymu,
}));
vi.mock("@/lib/delivery/service", () => ({
  deliverOrder: timeoutMocks.deliver,
}));
import { processPaymentJob } from "@/lib/payments/process-payment-job";

const cancellation = readFileSync(new URL("../src/lib/customer-cancellation.ts", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../src/lib/payments/checkout.ts", import.meta.url), "utf8");
const sociabuzzCancellation = readFileSync(new URL("../src/lib/payments/sociabuzz-cancellation.ts", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/lib/customer-wallet.ts", import.meta.url), "utf8");
const qr = readFileSync(new URL("../src/lib/payments/sociabuzz-service.ts", import.meta.url), "utf8");

const createdAt = new Date("2026-10-01T00:00:00.000Z");

describe("automatic unpaid order timeout", () => {
  it("uses the exact createdAt plus ten-minute boundary", () => {
    const deadline = getUnpaidOrderDeadline(createdAt);
    expect(deadline.toISOString()).toBe("2026-10-01T00:10:00.000Z");
    expect(isUnpaidOrderExpired(createdAt, new Date("2026-10-01T00:09:59.999Z"))).toBe(false);
    expect(isUnpaidOrderExpired(createdAt, deadline)).toBe(true);
    expect(isUnpaidOrderExpired(createdAt, new Date("2026-10-01T00:10:00.001Z"))).toBe(true);
  });

  it("expires draft and missing external IDs without calling a gateway", async () => {
    timeoutMocks.cancel.mockClear();
    timeoutMocks.sociaBuzz.mockClear();
    timeoutMocks.ipaymu.mockClear();
    timeoutMocks.cancel.mockResolvedValue({ status: "CANCELLED" });
    const now = new Date("2026-10-01T00:11:00.000Z");
    for (const externalId of ["ipaymu_draft:bni:order-1", null]) {
      expect(await processPaymentJob({
        id: "payment-1", provider: "IPAYMU",
        externalId, status: "PENDING",
        order: { id: "order-1", status: "PENDING", createdAt },
      }, now)).toBe("cancelled");
    }
    expect(timeoutMocks.cancel).toHaveBeenCalledTimes(2);
    expect(timeoutMocks.sociaBuzz).not.toHaveBeenCalled();
    expect(timeoutMocks.ipaymu).not.toHaveBeenCalled();
  });

  it("verifies active SociaBuzz invoices before automatic cancellation", async () => {
    timeoutMocks.cancel.mockClear();
    timeoutMocks.sociaBuzz.mockClear();
    timeoutMocks.cancel.mockResolvedValue({ status: "CANCELLED" });
    timeoutMocks.sociaBuzz.mockResolvedValue({ status: "PENDING" });
    await processPaymentJob({
      id: "payment-1", provider: "SOCIABUZZ",
      externalId: "scbz:session-1", status: "PENDING",
      order: { id: "order-1", status: "PENDING", createdAt },
    }, new Date("2026-10-01T00:11:00.000Z"));
    expect(timeoutMocks.sociaBuzz).toHaveBeenCalledWith("order-1");
    expect(timeoutMocks.cancel).toHaveBeenCalledWith(
      "order-1", new Date("2026-10-01T00:11:00.000Z"),
    );
    expect(timeoutMocks.sociaBuzz.mock.invocationCallOrder.at(-1))
      .toBeLessThan(timeoutMocks.cancel.mock.invocationCallOrder.at(-1)!);
  });

  it("keeps serializable retry and conditional cancellation guards", () => {
    expect(cancellation).toContain('isolationLevel: "Serializable"');
    expect(cancellation).toContain("attempt < 3");
    expect(cancellation).toContain('action: "ORDER_AUTO_CANCELLED_UNPAID"');
    expect(cancellation).toContain('status: { in: ["PENDING", "EXPIRED", "FAILED"] }');
    expect(cancellation).toContain('assignedOrderId: orderId, status: "ASSIGNED", isSold: false');
    expect(checkout).toContain('assignedOrderId: order.id, status: "ASSIGNED", isSold: false');
    expect(sociabuzzCancellation).toContain("SOCIABUZZ_CANCELLED_MONITORING");
    expect(sociabuzzCancellation).toContain('userId: order.userId');
  });

  it("blocks late QR creation and wallet payment", () => {
    expect(qr).toContain("isUnpaidOrderExpired(current.createdAt)");
    expect(wallet).toContain("isUnpaidOrderExpired(order.createdAt)");
  });
});
