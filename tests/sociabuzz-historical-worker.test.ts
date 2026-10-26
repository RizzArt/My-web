import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), updateMany: vi.fn(), processJob: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { payment: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/payments/process-payment-job", () => ({
  processPaymentJob: mocks.processJob,
}));

import { runSociaBuzzHistoricalReconciliation } from "@/lib/payments/sociabuzz-historical-worker";

const now = new Date("2026-10-06T00:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.processJob.mockResolvedValue("monitoring");
});

describe("historical SociaBuzz reconciliation", () => {
  it("uses a bounded due queue and only updates the dedicated cadence timestamp", async () => {
    mocks.findMany.mockResolvedValueOnce([{
      id: "payment-1", provider: "SOCIABUZZ", externalId: "scbz:session",
      status: "CANCELLED", order: { id: "order-1", status: "CANCELLED", createdAt: now },
    }]);
    await runSociaBuzzHistoricalReconciliation(now);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      where: expect.objectContaining({
        provider: "SOCIABUZZ", status: "CANCELLED", paidAt: null,
      }),
    }));
    expect(mocks.processJob).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lateLastCheckedAt: expect.any(Date) },
    }));
    expect(mocks.updateMany.mock.calls[0][0].data.updatedAt).toBeUndefined();
  });

  it("uses the existing process path so duplicate paid evidence stays idempotent", async () => {
    mocks.findMany.mockResolvedValueOnce([{
      id: "payment-1", provider: "SOCIABUZZ", externalId: "scbz:session",
      status: "CANCELLED", order: { id: "order-1", status: "CANCELLED", createdAt: now },
    }]);
    await runSociaBuzzHistoricalReconciliation(now);
    expect(mocks.processJob).toHaveBeenCalledWith(expect.objectContaining({
      id: "payment-1", status: "CANCELLED",
    }), now);
  });
});
