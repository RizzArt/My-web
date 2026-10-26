-- Review only. Do not run automatically in production.
ALTER TYPE "public"."WalletTransactionType" ADD VALUE IF NOT EXISTS 'PURCHASE_DEBIT';
ALTER TYPE "public"."WalletTransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_HOLD';
ALTER TYPE "public"."WalletTransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_RELEASE';
CREATE TYPE "public"."CancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "public"."CustomerWithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

CREATE TABLE "public"."CancellationRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "public"."CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "adminNote" TEXT,
  CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CancellationRequest_orderId_key" ON "public"."CancellationRequest"("orderId");
CREATE INDEX "CancellationRequest_status_createdAt_idx" ON "public"."CancellationRequest"("status", "createdAt");
CREATE INDEX "CancellationRequest_userId_createdAt_idx" ON "public"."CancellationRequest"("userId", "createdAt");
ALTER TABLE "public"."CancellationRequest" ADD CONSTRAINT "CancellationRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."CancellationRequest" ADD CONSTRAINT "CancellationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."CancellationRequest" ADD CONSTRAINT "CancellationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."CustomerWithdrawal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" "public"."CustomerWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "payoutType" "public"."RefundPayoutType" NOT NULL,
  "payoutProvider" TEXT NOT NULL,
  "payoutAccountNumberEncrypted" TEXT NOT NULL,
  "payoutAccountName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "adminNote" TEXT,
  "paidAt" TIMESTAMP(3),
  "transferReference" TEXT,
  CONSTRAINT "CustomerWithdrawal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerWithdrawal_status_createdAt_idx" ON "public"."CustomerWithdrawal"("status", "createdAt");
CREATE INDEX "CustomerWithdrawal_userId_createdAt_idx" ON "public"."CustomerWithdrawal"("userId", "createdAt");
ALTER TABLE "public"."CustomerWithdrawal" ADD CONSTRAINT "CustomerWithdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."CustomerWithdrawal" ADD CONSTRAINT "CustomerWithdrawal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
