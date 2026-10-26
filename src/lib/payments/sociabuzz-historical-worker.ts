import { prisma } from "@/lib/prisma";
import { processPaymentJob, type PaymentJob } from "./process-payment-job";
import {
  historicalCancelledSociaBuzzWhere,
  lateMonitoringOrder,
  SOCIABUZZ_HISTORICAL_BATCH_SIZE,
} from "./sociabuzz-late-monitoring";

const select = {
  id: true, provider: true, externalId: true, status: true,
  order: { select: { id: true, status: true, createdAt: true } },
};

export async function runSociaBuzzHistoricalReconciliation(now = new Date()) {
  const jobs = await prisma.payment.findMany({
    where: historicalCancelledSociaBuzzWhere(now),
    select,
    take: SOCIABUZZ_HISTORICAL_BATCH_SIZE,
    orderBy: lateMonitoringOrder,
  });

  const counters = { monitoring: 0, failed: 0 };
  for (let index = 0; index < jobs.length; index += 4) {
    await Promise.all(jobs.slice(index, index + 4).map(async (job) => {
      try {
        await processPaymentJob(job as PaymentJob, now);
        counters.monitoring += 1;
      } catch {
        counters.failed += 1;
        console.error("Historical SociaBuzz reconciliation requires retry", {
          paymentId: job.id,
        });
      } finally {
        // This schedules a new historical attempt without using generic updatedAt.
        try {
          await prisma.payment.updateMany({
            where: {
              id: job.id,
              provider: "SOCIABUZZ",
              status: "CANCELLED",
              paidAt: null,
            },
            data: { lateLastCheckedAt: new Date() },
          });
        } catch {
          counters.failed += 1;
          console.error("Historical SociaBuzz reconciliation cadence update failed", {
            paymentId: job.id,
          });
        }
      }
    }));
  }

  console.info("Historical SociaBuzz reconciliation completed", {
    checked: jobs.length,
    monitoring: counters.monitoring,
    failed: counters.failed,
  });
  return { checked: jobs.length, ...counters };
}
