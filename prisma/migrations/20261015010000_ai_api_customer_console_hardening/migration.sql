BEGIN;

-- Makes browser/API-key issuance replay-safe without persisting plaintext.
ALTER TABLE "AiApiKey" ADD COLUMN "issuanceEventKey" TEXT;
CREATE UNIQUE INDEX "AiApiKey_issuanceEventKey_key" ON "AiApiKey"("issuanceEventKey");

COMMIT;