BEGIN;

ALTER TABLE "AiApiRequest"
  ADD COLUMN "responseReplayCiphertext" TEXT,
  ADD COLUMN "responseReplayExpiresAt" TIMESTAMP(3);

CREATE INDEX "AiApiRequest_responseReplayExpiresAt_idx"
  ON "AiApiRequest"("responseReplayExpiresAt");

ALTER TABLE "AiApiRequest"
  ADD CONSTRAINT "AiApiRequest_completed_provider_identity"
  CHECK ("status" <> 'COMPLETED' OR "providerRequestId" IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION ai_api_request_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId" THEN
    RAISE EXCEPTION 'AiApiRequest providerRequestId is immutable once set';
  END IF;
  IF OLD."promptTokens" IS NOT NULL AND NEW."promptTokens" IS DISTINCT FROM OLD."promptTokens" THEN
    RAISE EXCEPTION 'AiApiRequest promptTokens is immutable once set';
  END IF;
  IF OLD."completionTokens" IS NOT NULL AND NEW."completionTokens" IS DISTINCT FROM OLD."completionTokens" THEN
    RAISE EXCEPTION 'AiApiRequest completionTokens is immutable once set';
  END IF;
  IF OLD."responseReplayCiphertext" IS NOT NULL
     AND NEW."responseReplayCiphertext" IS DISTINCT FROM OLD."responseReplayCiphertext"
     AND NOT (
       OLD."responseReplayExpiresAt" IS NOT NULL
       AND OLD."responseReplayExpiresAt" <= CURRENT_TIMESTAMP
       AND NEW."responseReplayCiphertext" IS NULL
       AND NEW."responseReplayExpiresAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'AiApiRequest responseReplayCiphertext is immutable once set';
  END IF;
  IF OLD."responseReplayExpiresAt" IS NOT NULL
     AND NEW."responseReplayExpiresAt" IS DISTINCT FROM OLD."responseReplayExpiresAt"
     AND NOT (
       OLD."responseReplayExpiresAt" <= CURRENT_TIMESTAMP
       AND NEW."responseReplayCiphertext" IS NULL
       AND NEW."responseReplayExpiresAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'AiApiRequest responseReplayExpiresAt is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AiApiRequest_evidence_immutable"
BEFORE UPDATE ON "AiApiRequest"
FOR EACH ROW
EXECUTE FUNCTION ai_api_request_evidence_immutable();

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE "AiApiModel"
  SET "maxRequestBytes" = 983040
  WHERE "publicId" IN (
    'minimax/minimax-m3',
    'gemini/gemini-3.8-flash-high',
    'cx/gpt-5.6-sol',
    'cc/claude-opus-5'
  );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 4 THEN
    RAISE EXCEPTION 'AI API catalog request-size migration did not update exactly four models';
  END IF;
END $$;

COMMIT;
