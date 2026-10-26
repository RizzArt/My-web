import { describe, expect, it } from "vitest";
import {
  historicalCancelledSociaBuzzWhere,
  hotCancelledSociaBuzzWhere,
  lateMonitoringOrder,
  SOCIABUZZ_HISTORICAL_INTERVAL_MS,
  SOCIABUZZ_HISTORICAL_MONITORING_MS,
  SOCIABUZZ_HOT_MONITORING_MS,
} from "@/lib/payments/sociabuzz-late-monitoring";

const now = new Date("2026-10-06T00:00:00.000Z");

describe("SociaBuzz hybrid late-payment queue", () => {
  it("keeps hot monitoring in the inclusive 72-hour window", () => {
    const where = hotCancelledSociaBuzzWhere(now);
    expect(where).toMatchObject({
      provider: "SOCIABUZZ",
      status: "CANCELLED",
      paidAt: null,
      externalId: { startsWith: "scbz:" },
      order: { is: { status: "CANCELLED" } },
      lateMonitoringStartedAt: {
        gte: new Date(now.getTime() - SOCIABUZZ_HOT_MONITORING_MS),
        lte: now,
      },
    });
  });

  it("keeps historical monitoring outside hot and inside 30 days", () => {
    const where = historicalCancelledSociaBuzzWhere(now);
    expect(where).toMatchObject({
      lateMonitoringStartedAt: {
        gte: new Date(now.getTime() - SOCIABUZZ_HISTORICAL_MONITORING_MS),
        lt: new Date(now.getTime() - SOCIABUZZ_HOT_MONITORING_MS),
      },
      OR: [
        { lateLastCheckedAt: null },
        { lateLastCheckedAt: { lte: new Date(now.getTime() - SOCIABUZZ_HISTORICAL_INTERVAL_MS) } },
      ],
    });
  });

  it("orders both queues by dedicated cadence metadata", () => {
    expect(lateMonitoringOrder).toEqual([
      { lateLastCheckedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ]);
  });

  it("keeps the 72-hour boundary hot and the 30-day boundary historical", () => {
    const hot = hotCancelledSociaBuzzWhere(now).lateMonitoringStartedAt as {
      gte: Date; lte: Date;
    };
    const historical = historicalCancelledSociaBuzzWhere(now).lateMonitoringStartedAt as {
      gte: Date; lt: Date;
    };
    expect(hot.gte).toEqual(historical.lt);
    expect(historical.gte).toEqual(new Date(
      now.getTime() - SOCIABUZZ_HISTORICAL_MONITORING_MS,
    ));
  });
});
