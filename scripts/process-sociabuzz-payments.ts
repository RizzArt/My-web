import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { UNPAID_ORDER_TIMEOUT_MS } from "../src/lib/order-expiry";
import { processPaymentJob } from "../src/lib/payments/process-payment-job";
import {
  activeSociaBuzzReference,
  hotCancelledSociaBuzzWhere,
  lateMonitoringOrder,
  SOCIABUZZ_HOT_BATCH_SIZE,
} from "../src/lib/payments/sociabuzz-late-monitoring";

const select = {
  id: true, provider: true, externalId: true, status: true,
  order: { select: { id: true, status: true, createdAt: true } },
} satisfies Prisma.PaymentSelect;

type QueuedPayment = Prisma.PaymentGetPayload<{ select: typeof select }>;

const activeInvoices: Prisma.PaymentWhereInput[] = [
  activeSociaBuzzReference(),
  { provider: "IPAYMU", externalId: { startsWith: "ipaymu:" } },
];

async function run() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - UNPAID_ORDER_TIMEOUT_MS);
  const groups: Array<{
    where: Prisma.PaymentWhereInput;
    orderBy: Prisma.PaymentOrderByWithRelationInput[];
    tracksLateMonitoring?: boolean;
  }> = [
    {
      where: {
        status: "PENDING",
        order: { is: { status: "PENDING", createdAt: { lte: cutoff } } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    },
    {
      where: {
        status: "PENDING", OR: activeInvoices,
        order: { is: { status: "PENDING", createdAt: { gt: cutoff } } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    },
    {
      where: hotCancelledSociaBuzzWhere(now),
      orderBy: lateMonitoringOrder,
      tracksLateMonitoring: true,
    },
    {
      // Keep IPAYMU cancelled-payment monitoring unchanged and isolated.
      where: {
        status: "CANCELLED", paidAt: null,
        provider: "IPAYMU", externalId: { startsWith: "ipaymu:" },
        order: { is: { status: "CANCELLED" } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    },
    {
      where: {
        status: "PAID",
        order: { is: {
          status: "PAID",
          deliveries: { none: {} },
        } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    },
  ];

  // Batas setiap kelompok menjaga polling dan monitoring tidak tertutup backlog.
  const batches = await Promise.all(groups.map((group) =>
    prisma.payment.findMany({
      where: group.where, select,
      take: group.tracksLateMonitoring ? SOCIABUZZ_HOT_BATCH_SIZE : 4,
      orderBy: group.orderBy,
    }),
  ));
  const jobs = [...new Map<string, { job: QueuedPayment; tracksLateMonitoring: boolean }>(
    batches.flatMap((batch, index) => batch.map((job) => [job.id, {
      job,
      tracksLateMonitoring: groups[index].tracksLateMonitoring === true,
    }])),
  ).values()];

  const counters = {
    paid: 0, cancelled: 0, verified: 0,
    monitoring: 0, delivery: 0, skipped: 0, failed: 0,
  };

  async function processOne(entry: (typeof jobs)[number]) {
    const { job, tracksLateMonitoring } = entry;
    try {
      const result = await processPaymentJob(job, new Date());
      counters[result] += 1;
    } catch {
      counters.failed += 1;
      console.error("Payment processing requires retry", {
        orderId: job.order.id, provider: job.provider,
      });
    } finally {
      // Rotasi antrean juga saat gateway gagal; tidak mengubah status pembayaran.
      try {
        await prisma.payment.updateMany({
          where: {
            id: job.id, provider: job.provider,
            externalId: job.externalId, status: job.status,
          },
          data: tracksLateMonitoring
            ? { lateLastCheckedAt: new Date() }
            : { updatedAt: new Date() },
        });
      } catch {
        counters.failed += 1;
        console.error("Payment queue rotation requires retry", {
          orderId: job.order.id,
        });
      }
    }
  }

  for (let index = 0; index < jobs.length; index += 4) {
    await Promise.all(jobs.slice(index, index + 4).map(processOne));
  }
  console.info(`Payments/expiry checked=${jobs.length} ${JSON.stringify(counters)}`);
}

run().catch(() => {
  console.error("Payment worker failed; check database and configuration.");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
