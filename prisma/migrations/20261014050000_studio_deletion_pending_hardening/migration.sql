ALTER TABLE "StudioGeneration"
ADD COLUMN "deletionPendingAt" TIMESTAMP(3);

ALTER TABLE "StudioReference"
ADD COLUMN "deletionPendingAt" TIMESTAMP(3);
