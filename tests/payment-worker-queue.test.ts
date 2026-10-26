import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), updateMany: vi.fn(),
  disconnect: vi.fn(), processJob: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    $disconnect: mocks.disconnect,
  },
}));
vi.mock("@/lib/payments/process-payment-job", () => ({
  processPaymentJob: mocks.processJob,
}));

let finished: Promise<void>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  finished = new Promise<void>((resolve) => {
    mocks.disconnect.mockImplementation(async () => { resolve(); });
  });
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.processJob.mockResolvedValue("skipped");
});

async function runWorker() {
  // Semua dependency worker dimock; tidak memakai database atau gateway.
  await import("../scripts/process-sociabuzz-payments");
  await finished;
}

function batch(group: number) {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `payment-${group}-${index}`,
    provider: "IPAYMU",
    externalId: index === 0 ? null : `ipaymu:${group * 10 + index}`,
    status: "PENDING",
    order: {
      id: `order-${group}-${index}`,
      status: "PENDING",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
  }));
}

describe("payment worker queue", () => {
  it("includes overdue drafts and missing external IDs in a bounded rotating queue", async () => {
    await runWorker();
    expect(mocks.findMany).toHaveBeenCalledTimes(5);
    const queries = mocks.findMany.mock.calls.map(([query]) => query);
    const overdue = queries[0];
    expect(overdue.where.status).toBe("PENDING");
    expect(overdue.where.order.is.status).toBe("PENDING");
    expect(overdue.where.order.is.createdAt.lte).toBeInstanceOf(Date);
    expect(overdue.where.externalId).toBeUndefined();
    expect(overdue.where.OR).toBeUndefined();
    for (const query of [queries[0], queries[1], queries[3], queries[4]]) {
      expect(query.take).toBe(4);
      expect(query.orderBy).toEqual([{ updatedAt: "asc" }, { id: "asc" }]);
    }
    expect(queries[2].take).toBe(4);
    expect(queries[2].orderBy).toEqual([
      { lateLastCheckedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ]);
  });

  it("reserves separate queue capacity for pending, cancelled and paid payments", async () => {
    await runWorker();
    const queries = mocks.findMany.mock.calls.map(([query]) => query);
    expect(queries[1].where.status).toBe("PENDING");
    expect(queries[1].where.order.is.createdAt.gt).toBeInstanceOf(Date);
    expect(queries[2].where).toMatchObject({
      status: "CANCELLED", paidAt: null,
      provider: "SOCIABUZZ",
      order: { is: { status: "CANCELLED" } },
    });
    expect(queries[3].where).toMatchObject({
      status: "CANCELLED", paidAt: null, provider: "IPAYMU",
      order: { is: { status: "CANCELLED" } },
    });
    expect(queries[4].where).toMatchObject({
      status: "PAID", order: { is: { status: "PAID" } },
    });
    expect(queries[1].where.OR.map((entry: { provider: string }) => entry.provider))
      .toEqual(["SOCIABUZZ", "IPAYMU"]);
  });

  it("processes at most four jobs in parallel and rotates without changing payment status", async () => {
    for (let group = 0; group < 5; group += 1) {
      mocks.findMany.mockResolvedValueOnce(batch(group));
    }
    let running = 0;
    let maximum = 0;
    mocks.processJob.mockImplementation(async () => {
      running += 1;
      maximum = Math.max(maximum, running);
      await Promise.resolve();
      running -= 1;
      return "skipped";
    });
    await runWorker();
    expect(mocks.processJob).toHaveBeenCalledTimes(20);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(mocks.updateMany).toHaveBeenCalledTimes(20);
    const hotUpdates = mocks.updateMany.mock.calls
      .map(([query]) => query)
      .filter((query) => "lateLastCheckedAt" in query.data);
    expect(hotUpdates).toHaveLength(4);
    for (const query of hotUpdates) {
      expect(Object.keys(query.data)).toEqual(["lateLastCheckedAt"]);
      expect(query.data.lateLastCheckedAt).toBeInstanceOf(Date);
    }
    const legacyUpdates = mocks.updateMany.mock.calls
      .map(([query]) => query)
      .filter((query) => "updatedAt" in query.data);
    expect(legacyUpdates).toHaveLength(16);
  });
});
