-- `isRead` predates evidence-based receipts. Keep historic rows nullable so
-- they never acquire an invented read timestamp during this rollout.
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);
