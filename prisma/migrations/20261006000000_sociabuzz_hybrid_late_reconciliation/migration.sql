-- Additive queue metadata for cancelled SociaBuzz late-payment reconciliation.
ALTER TABLE "Payment"
ADD COLUMN "lateMonitoringStartedAt" TIMESTAMP(3),
ADD COLUMN "lateLastCheckedAt" TIMESTAMP(3);

CREATE INDEX "Payment_provider_status_paidAt_lateMonitoringStartedAt_idx"
ON "Payment"("provider", "status", "paidAt", "lateMonitoringStartedAt");

CREATE INDEX "Payment_provider_status_paidAt_lateLastCheckedAt_idx"
ON "Payment"("provider", "status", "paidAt", "lateLastCheckedAt");
