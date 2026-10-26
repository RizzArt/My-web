ALTER TABLE "StudioGeneration"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "StudioGeneration_userId_deletedAt_createdAt_idx"
ON "StudioGeneration"("userId", "deletedAt", "createdAt");
