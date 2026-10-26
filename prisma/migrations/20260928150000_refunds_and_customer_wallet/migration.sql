-- Refunds and customer wallet. Review and run only through the approved production migration process.
CREATE TYPE "public"."RefundMethod" AS ENUM ('ACCOUNT_BALANCE', 'MANUAL_TRANSFER');
CREATE TYPE "public"."RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED');
CREATE TYPE "public"."RefundPayoutType" AS ENUM ('BANK', 'EWALLET');
CREATE TYPE "public"."WalletTransactionType" AS ENUM ('REFUND_CREDIT');

ALTER TABLE "public"."User" ADD COLUMN "balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."Order" ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE TABLE "public"."RefundRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "public"."RefundMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "public"."RefundStatus" NOT NULL DEFAULT 'PENDING',
    "payoutType" "public"."RefundPayoutType",
    "payoutProvider" TEXT,
    "payoutAccountNumberEncrypted" TEXT,
    "payoutAccountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "adminNote" TEXT,
    "refundedAt" TIMESTAMP(3),
    "transferReference" TEXT,
    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."WalletTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "refundRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRequest_orderId_key" ON "public"."RefundRequest"("orderId");
CREATE UNIQUE INDEX "WalletTransaction_refundRequestId_key" ON "public"."WalletTransaction"("refundRequestId");
CREATE UNIQUE INDEX "WalletTransaction_type_referenceType_referenceId_key" ON "public"."WalletTransaction"("type", "referenceType", "referenceId");
CREATE INDEX "RefundRequest_status_createdAt_idx" ON "public"."RefundRequest"("status", "createdAt");
CREATE INDEX "RefundRequest_userId_createdAt_idx" ON "public"."RefundRequest"("userId", "createdAt");
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "public"."WalletTransaction"("userId", "createdAt");

ALTER TABLE "public"."RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."RefundRequest" ADD CONSTRAINT "RefundRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."RefundRequest" ADD CONSTRAINT "RefundRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."WalletTransaction" ADD CONSTRAINT "WalletTransaction_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "public"."RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
