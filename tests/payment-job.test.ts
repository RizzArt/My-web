import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  cancel: vi.fn(),
  sociaBuzz: vi.fn(),
  ipaymu: vi.fn(),
  fulfill: vi.fn(),
}));

vi.mock("@/lib/delivery/service", () => ({ deliverOrder: mocks.deliver }));
vi.mock("@/lib/payments/paid-order-fulfillment", () => ({ fulfillPaidOrder: mocks.fulfill }));
vi.mock("@/lib/customer-cancellation", () => ({
  autoCancelExpiredOrder: mocks.cancel,
}));
vi.mock("@/lib/payments/sociabuzz-service", () => ({
  verifySociaBuzzOrder: mocks.sociaBuzz,
}));
vi.mock("@/lib/payments/ipaymu-verification", () => ({
  verifyIpaymuOrder: mocks.ipaymu,
}));

import {
  processPaymentJob, type PaymentJob,
} from "../src/lib/payments/process-payment-job";

const now = new Date("2026-10-01T14:00:00Z");
function job(change: Partial<PaymentJob> = {}): PaymentJob {
  return {
    id: "payment-1", provider: "IPAYMU", externalId: "ipaymu:123",
    status: "PENDING",
    order: {
      id: "order-1", status: "PENDING",
      createdAt: new Date("2026-10-01T13:40:00Z"),
    },
    ...change,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cancel.mockResolvedValue({ status: "CANCELLED" });
  mocks.ipaymu.mockResolvedValue({ status: "PENDING" });
  mocks.sociaBuzz.mockResolvedValue({ status: "PENDING" });
});

describe("payment worker decisions", () => {
  it("never cancels when VA verification fails", async () => {
    mocks.ipaymu.mockRejectedValue(new Error("gateway unavailable"));
    await expect(processPaymentJob(job(), now)).rejects.toThrow();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("never cancels a verified paid VA", async () => {
    mocks.ipaymu.mockResolvedValue({ status: "PAID" });
    expect(await processPaymentJob(job(), now)).toBe("paid");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("verifies an unpaid invoice before cancelling it", async () => {
    expect(await processPaymentJob(job(), now)).toBe("cancelled");
    expect(mocks.ipaymu.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancel.mock.invocationCallOrder[0],
    );
  });

  it("checks active VA payments before the ten-minute deadline", async () => {
    const pending = job();
    pending.order.createdAt = new Date("2026-10-01T13:55:00Z");
    expect(await processPaymentJob(pending, now)).toBe("verified");
    expect(mocks.ipaymu).toHaveBeenCalledWith("order-1");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("expires a draft without creating or checking an invoice", async () => {
    expect(await processPaymentJob(job({
      externalId: "ipaymu_draft:bni:order-1",
    }), now)).toBe("cancelled");
    expect(mocks.ipaymu).not.toHaveBeenCalled();
  });

  it("expires an uncertain request through the existing cancellation flow", async () => {
    expect(await processPaymentJob(job({
      externalId: "ipaymu_creating:bni:order-1",
    }), now)).toBe("cancelled");
    expect(mocks.cancel).toHaveBeenCalledWith("order-1", now);
    expect(mocks.ipaymu).not.toHaveBeenCalled();
  });

  it("monitors cancelled VA without reopening the order", async () => {
    const cancelled = job({ status: "CANCELLED" });
    cancelled.order.status = "CANCELLED";
    expect(await processPaymentJob(cancelled, now)).toBe("monitoring");
    expect(mocks.ipaymu).toHaveBeenCalledWith("order-1");
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("keeps SociaBuzz late-payment monitoring", async () => {
    const cancelled = job({
      provider: "SOCIABUZZ", externalId: "scbz:session-1",
      status: "CANCELLED",
    });
    cancelled.order.status = "CANCELLED";
    await processPaymentJob(cancelled, now);
    expect(mocks.sociaBuzz).toHaveBeenCalledWith("order-1");
    expect(mocks.ipaymu).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("never cancels when SociaBuzz verification fails", async () => {
    mocks.sociaBuzz.mockRejectedValue(new Error("gateway unavailable"));
    await expect(processPaymentJob(job({
      provider: "SOCIABUZZ", externalId: "scbz:session-1",
    }), now)).rejects.toThrow();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("retries delivery for a paid order", async () => {
    const paid = job({ status: "PAID" });
    paid.order.status = "PAID";
    expect(await processPaymentJob(paid, now)).toBe("delivery");
    expect(mocks.fulfill).toHaveBeenCalledWith("order-1");
    expect(mocks.ipaymu).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
