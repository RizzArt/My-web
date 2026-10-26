import { prisma } from "../src/lib/prisma";
import { runSociaBuzzHistoricalReconciliation } from "../src/lib/payments/sociabuzz-historical-worker";

runSociaBuzzHistoricalReconciliation().catch(() => {
  console.error("Historical SociaBuzz reconciliation failed; check service logs.");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
