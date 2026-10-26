import { prisma } from "../src/lib/prisma";
import { verifySociaBuzzOrder } from "../src/lib/payments/sociabuzz-service";

const paymentId = process.argv[2];
if (!paymentId) throw new Error("Usage: reconcile-sociabuzz-late-payment.ts PAYMENT_ID");

async function run() {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, provider: true, externalId: true, status: true, paidAt: true,
      order: { select: { id: true, status: true } },
    },
  });
  if (
    !payment ||
    payment.provider !== "SOCIABUZZ" ||
    !payment.externalId?.startsWith("scbz:") ||
    payment.status !== "CANCELLED" ||
    payment.order.status !== "CANCELLED"
  ) throw new Error("Payment is not eligible for authoritative late reconciliation.");

  // This is intentionally the same verification and idempotent credit path as workers.
  const result = await verifySociaBuzzOrder(payment.order.id);
  console.info("Manual SociaBuzz late reconciliation completed", {
    paymentId: payment.id,
    result: result.status,
  });
}

run().catch((error) => {
  console.error("Manual SociaBuzz late reconciliation failed", {
    error: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
