-- Additive Studio Credit purchase ledger. Historic balances and transactions are untouched.
ALTER TYPE "StudioCreditTransactionType" ADD VALUE IF NOT EXISTS 'TOPUP_PURCHASE';

CREATE TABLE "StudioCreditTopUp" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "creditedAt" TIMESTAMP(3),
    "refundReviewAt" TIMESTAMP(3),
    "refundReviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioCreditTopUp_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StudioCreditTransaction" ADD COLUMN "topUpId" TEXT;
CREATE UNIQUE INDEX "StudioCreditTopUp_orderId_key" ON "StudioCreditTopUp"("orderId");
CREATE INDEX "StudioCreditTopUp_userId_createdAt_idx" ON "StudioCreditTopUp"("userId", "createdAt");
CREATE UNIQUE INDEX "StudioCreditTransaction_topUpId_key" ON "StudioCreditTransaction"("topUpId");
ALTER TABLE "StudioCreditTopUp" ADD CONSTRAINT "StudioCreditTopUp_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioCreditTopUp" ADD CONSTRAINT "StudioCreditTopUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioCreditTransaction" ADD CONSTRAINT "StudioCreditTransaction_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "StudioCreditTopUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
