-- Manual deliveries need a state between seller send and buyer acceptance.
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CONFIRMATION';

ALTER TABLE "DigitalDelivery"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "autoAcceptAt" TIMESTAMP(3),
  ADD COLUMN "buyerAcceptedAt" TIMESTAMP(3);

CREATE INDEX "DigitalDelivery_status_autoAcceptAt_idx"
  ON "DigitalDelivery"("status", "autoAcceptAt");
