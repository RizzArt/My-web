import { Prisma } from "@prisma/client";

export const SOCIABUZZ_HOT_MONITORING_MS = 72 * 60 * 60 * 1000;
export const SOCIABUZZ_HISTORICAL_MONITORING_MS = 30 * 24 * 60 * 60 * 1000;
export const SOCIABUZZ_HISTORICAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SOCIABUZZ_HOT_BATCH_SIZE = 4;
export const SOCIABUZZ_HISTORICAL_BATCH_SIZE = 100;

export function activeSociaBuzzReference(): Prisma.PaymentWhereInput {
  return {
    provider: "SOCIABUZZ",
    externalId: { startsWith: "scbz:" },
  };
}

function cancelledSociaBuzzBase(): Prisma.PaymentWhereInput {
  return {
    ...activeSociaBuzzReference(),
    status: "CANCELLED",
    paidAt: null,
    order: { is: { status: "CANCELLED" } },
  };
}

export function hotCancelledSociaBuzzWhere(now = new Date()): Prisma.PaymentWhereInput {
  return {
    ...cancelledSociaBuzzBase(),
    lateMonitoringStartedAt: {
      gte: new Date(now.getTime() - SOCIABUZZ_HOT_MONITORING_MS),
      lte: now,
    },
  };
}

export function historicalCancelledSociaBuzzWhere(now = new Date()): Prisma.PaymentWhereInput {
  const hotBoundary = new Date(now.getTime() - SOCIABUZZ_HOT_MONITORING_MS);
  const historicalBoundary = new Date(now.getTime() - SOCIABUZZ_HISTORICAL_MONITORING_MS);
  const dueBoundary = new Date(now.getTime() - SOCIABUZZ_HISTORICAL_INTERVAL_MS);

  return {
    ...cancelledSociaBuzzBase(),
    lateMonitoringStartedAt: { gte: historicalBoundary, lt: hotBoundary },
    OR: [
      { lateLastCheckedAt: null },
      { lateLastCheckedAt: { lte: dueBoundary } },
    ],
  };
}

export const lateMonitoringOrder = [
  { lateLastCheckedAt: { sort: "asc", nulls: "first" } },
  { id: "asc" },
] satisfies Prisma.PaymentOrderByWithRelationInput[];
