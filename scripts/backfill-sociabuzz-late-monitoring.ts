import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

if (apply && process.env.SOCIABUZZ_LATE_MONITORING_BACKFILL_CONFIRMED !== "YES") {
  throw new Error("Set SOCIABUZZ_LATE_MONITORING_BACKFILL_CONFIRMED=YES for --apply.");
}

async function run() {
  const where = {
    provider: "SOCIABUZZ" as const,
    status: "CANCELLED" as const,
    paidAt: null,
    externalId: { startsWith: "scbz:" },
    order: { is: { status: "CANCELLED" as const } },
  };
  const select = {
    id: true,
    events: {
      where: {
        provider: "SOCIABUZZ",
        eventType: "SOCIABUZZ_CANCELLED_MONITORING",
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" as const },
      take: 1,
    },
  };

  // Dry-run deliberately uses only the pre-migration schema, so it can audit
  // production before the additive columns exist.
  const rows = await prisma.payment.findMany({ where, select });
  const payments = apply
    ? await prisma.payment.findMany({
      where,
      select: { ...select, lateMonitoringStartedAt: true },
    })
    : rows.map((payment) => ({ ...payment, lateMonitoringStartedAt: null }));

  const candidates = payments.filter((payment) => !payment.lateMonitoringStartedAt);
  const authoritative = candidates.filter((payment) => payment.events[0]);
  const fallback = candidates.filter((payment) => !payment.events[0]);

  if (apply) {
    for (const payment of authoritative) {
      await prisma.payment.updateMany({
        where: { id: payment.id, lateMonitoringStartedAt: null },
        data: { lateMonitoringStartedAt: payment.events[0].createdAt },
      });
    }
  }

  // Rows without the immutable event stay outside automatic reconciliation.
  console.info("SociaBuzz late-monitoring backfill", {
    mode: apply ? "apply" : "dry-run",
    existingTimestampRows: apply ? payments.length - candidates.length : "not_checked_pre_migration",
    authoritativeEventRows: authoritative.length,
    fallbackRows: fallback.length,
    fallbackPolicy: "excluded_from_automatic_monitoring_pending_manual_review",
  });
}

run().catch((error) => {
  console.error("SociaBuzz late-monitoring backfill failed", {
    error: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
