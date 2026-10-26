CREATE TYPE "StudioGenerationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "StudioCreditTransactionType" AS ENUM ('ADMIN_CREDIT', 'GENERATION_DEBIT', 'GENERATION_REFUND');

ALTER TABLE "User" ADD COLUMN "studioCredits" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "StudioModelConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creditCostPerImage" INTEGER NOT NULL,
    "supportsReferenceImage" BOOLEAN NOT NULL DEFAULT false,
    "supportedAspectRatios" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioModelConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelConfigId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "outputCount" INTEGER NOT NULL,
    "referenceStorageKey" TEXT,
    "status" "StudioGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "creditCost" INTEGER NOT NULL,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioReference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioGenerationOutput" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioGenerationOutput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioCreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT,
    "type" "StudioCreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioCreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioModelConfig_provider_model_key" ON "StudioModelConfig"("provider", "model");
CREATE INDEX "StudioModelConfig_isEnabled_idx" ON "StudioModelConfig"("isEnabled");
CREATE INDEX "StudioGeneration_userId_createdAt_idx" ON "StudioGeneration"("userId", "createdAt");
CREATE INDEX "StudioGeneration_status_createdAt_idx" ON "StudioGeneration"("status", "createdAt");
CREATE UNIQUE INDEX "StudioGenerationOutput_storageKey_key" ON "StudioGenerationOutput"("storageKey");
CREATE UNIQUE INDEX "StudioReference_storageKey_key" ON "StudioReference"("storageKey");
CREATE INDEX "StudioReference_userId_createdAt_idx" ON "StudioReference"("userId", "createdAt");
CREATE UNIQUE INDEX "StudioGenerationOutput_generationId_position_key" ON "StudioGenerationOutput"("generationId", "position");
CREATE UNIQUE INDEX "StudioCreditTransaction_generationId_type_key" ON "StudioCreditTransaction"("generationId", "type");
CREATE INDEX "StudioCreditTransaction_userId_createdAt_idx" ON "StudioCreditTransaction"("userId", "createdAt");

ALTER TABLE "StudioGeneration" ADD CONSTRAINT "StudioGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioGeneration" ADD CONSTRAINT "StudioGeneration_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "StudioModelConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioReference" ADD CONSTRAINT "StudioReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioGenerationOutput" ADD CONSTRAINT "StudioGenerationOutput_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "StudioGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioCreditTransaction" ADD CONSTRAINT "StudioCreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioCreditTransaction" ADD CONSTRAINT "StudioCreditTransaction_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "StudioGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "StudioModelConfig" ("id", "provider", "model", "displayName", "isEnabled", "creditCostPerImage", "supportsReferenceImage", "supportedAspectRatios", "updatedAt") VALUES
  ('studio_gemini_flash_image', 'GEMINI', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', false, 10, true, '["1:1", "16:9", "9:16", "4:3", "3:4"]', CURRENT_TIMESTAMP),
  ('studio_leonardo_default', 'LEONARDO', 'CHANGE_ME_LEONARDO_MODEL_ID', 'Leonardo Image', false, 20, false, '["1:1", "16:9", "9:16", "4:3", "3:4"]', CURRENT_TIMESTAMP);
