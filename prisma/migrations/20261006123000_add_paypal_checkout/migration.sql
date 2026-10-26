-- Stores exact USD/FX evidence separately; existing IDR payment rows are untouched.
CREATE TYPE "PayPalCheckoutStatus" AS ENUM ('CREATED', 'CAPTURED', 'REVIEW_REQUIRED');

CREATE TABLE "PayPalCheckout" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "paypalOrderId" TEXT,
    "captureId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "idrToUsdRate" TEXT NOT NULL,
    "expectedMerchantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PayPalCheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "reviewReason" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayPalCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayPalCheckout_paymentId_key" ON "PayPalCheckout"("paymentId");
CREATE UNIQUE INDEX "PayPalCheckout_paypalOrderId_key" ON "PayPalCheckout"("paypalOrderId");
CREATE UNIQUE INDEX "PayPalCheckout_captureId_key" ON "PayPalCheckout"("captureId");
CREATE INDEX "PayPalCheckout_status_expiresAt_idx" ON "PayPalCheckout"("status", "expiresAt");
ALTER TABLE "PayPalCheckout" ADD CONSTRAINT "PayPalCheckout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No seed row: production must never satisfy the Sandbox isolation gate.
CREATE TABLE "PayPalSandboxEnvironment" (
    "id" TEXT NOT NULL DEFAULT 'paypal-sandbox',
    "instanceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayPalSandboxEnvironment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayPalSandboxEnvironment_instanceId_key" ON "PayPalSandboxEnvironment"("instanceId");
