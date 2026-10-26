BEGIN;

-- Bound waits and hold admission/catalog writes until validation and staging commit.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE "AiApiModel", "AiApiProviderHealth", "AiApiRequest" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "AiApiPriceVersion" IN ACCESS EXCLUSIVE MODE;

-- Defaults preserve every historical quote; no historical rates or requests change.
ALTER TABLE "AiApiPriceVersion"
  ADD COLUMN "upstreamMinimumMicros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "retailMinimumMicros" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "AiApiPriceVersion_request_minimum_nonnegative"
    CHECK ("upstreamMinimumMicros" >= 0 AND "retailMinimumMicros" >= 0),
  ADD CONSTRAINT "AiApiPriceVersion_request_minimum_pair"
    CHECK (("upstreamMinimumMicros" = 0 AND "retailMinimumMicros" = 0)
      OR ("upstreamMinimumMicros" > 0 AND "retailMinimumMicros" > 0));

-- Preserve the existing one-time effective-range closure, but make the new
-- versioned fields immutable too. This prevents a closure from repricing v1.
CREATE OR REPLACE FUNCTION ai_api_price_guard_mutation() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW."modelId", OLD."modelId"), 9917301));
  IF TG_OP = 'UPDATE'
    AND OLD."effectiveTo" IS NULL
    AND NEW."effectiveTo" IS NOT NULL
    AND NEW."effectiveTo" > OLD."effectiveFrom"
    AND NEW."id" = OLD."id"
    AND NEW."modelId" = OLD."modelId"
    AND NEW."version" = OLD."version"
    AND NEW."currency" = OLD."currency"
    AND NEW."upstreamInputMicrosPerMillion" = OLD."upstreamInputMicrosPerMillion"
    AND NEW."upstreamOutputMicrosPerMillion" = OLD."upstreamOutputMicrosPerMillion"
    AND NEW."retailInputMicrosPerMillion" = OLD."retailInputMicrosPerMillion"
    AND NEW."retailOutputMicrosPerMillion" = OLD."retailOutputMicrosPerMillion"
    AND NEW."upstreamMinimumMicros" = OLD."upstreamMinimumMicros"
    AND NEW."retailMinimumMicros" = OLD."retailMinimumMicros"
    AND NEW."calculatorVersion" = OLD."calculatorVersion"
    AND NEW."sourceVersion" = OLD."sourceVersion"
    AND NEW."verifiedAt" IS NOT DISTINCT FROM OLD."verifiedAt"
    AND NEW."effectiveFrom" = OLD."effectiveFrom"
    AND NEW."createdAt" = OLD."createdAt"
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AI API price history is immutable except one-time range closure';
END;
$$ LANGUAGE plpgsql;

-- Nonzero request floors are evidence-scoped. A future provider/model needs a
-- new reviewed migration; zero remains the backwards-compatible token-only mode.
CREATE OR REPLACE FUNCTION ai_api_price_floor_guard() RETURNS trigger AS $$
BEGIN
  -- Let the table CHECK report negative values with its stable constraint name.
  IF NEW."upstreamMinimumMicros" < 0 OR NEW."retailMinimumMicros" < 0 THEN
    RETURN NEW;
  END IF;
  IF NEW."upstreamMinimumMicros" = 0 AND NEW."retailMinimumMicros" = 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."effectiveTo" IS NOT NULL THEN
    RAISE EXCEPTION 'AI API request floor configuration is not evidence-scoped';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."effectiveTo" IS NOT NULL OR NEW."effectiveTo" IS NULL OR NEW."effectiveTo" <= NEW."effectiveFrom") THEN
    RAISE EXCEPTION 'AI API request floor configuration is not evidence-scoped';
  END IF;
  IF NEW."id" IS DISTINCT FROM 'ai-price-griphub-minimax-m3-v2'
    OR NEW."modelId" IS DISTINCT FROM 'ai-model-griphub-minimax-m3'
    OR NEW."version" IS DISTINCT FROM 2
    OR NEW."currency" IS DISTINCT FROM 'IDR'
    OR NEW."upstreamInputMicrosPerMillion" IS DISTINCT FROM 150000000::BIGINT
    OR NEW."upstreamOutputMicrosPerMillion" IS DISTINCT FROM 150000000::BIGINT
    OR NEW."retailInputMicrosPerMillion" IS DISTINCT FROM 225000000::BIGINT
    OR NEW."retailOutputMicrosPerMillion" IS DISTINCT FROM 225000000::BIGINT
    OR NEW."upstreamMinimumMicros" IS DISTINCT FROM 3000000::BIGINT
    OR NEW."retailMinimumMicros" IS DISTINCT FROM 4500000::BIGINT
    OR NEW."calculatorVersion" IS DISTINCT FROM 'text-token-floor-v2'
    OR NEW."sourceVersion" IS DISTINCT FROM 'GRIPHUB-operator-attested-pending-receipt-2026-10-22-Base-routing'
    OR NEW."verifiedAt" IS NOT NULL
    OR NEW."effectiveFrom" IS NULL
    OR NOT isfinite(NEW."effectiveFrom")
    OR NEW."createdAt" IS NULL
    OR NOT isfinite(NEW."createdAt")
    OR NOT EXISTS (
      SELECT 1 FROM "AiApiModel"
      WHERE "id" = NEW."modelId"
        AND "publicId" = 'griphub/minimax-m3'
        AND "provider" = 'GRIPHUB'
        AND "upstreamModelId" = 'minimax-m3'
    )
  THEN
    RAISE EXCEPTION 'AI API request floor configuration is not evidence-scoped';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- PostgreSQL invokes same-timing triggers in name order. Keep the scope guard
-- after the existing immutable-history guard so a closed price version reports
-- history immutability before any proposed replacement floor is evaluated.
CREATE TRIGGER "Z_AiApiPriceVersion_floor_scope"
BEFORE INSERT OR UPDATE ON "AiApiPriceVersion"
FOR EACH ROW EXECUTE FUNCTION ai_api_price_floor_guard();

DO $$
DECLARE
  target_model "AiApiModel"%ROWTYPE;
  previous_price "AiApiPriceVersion"%ROWTYPE;
  boundary TIMESTAMP(3);
BEGIN
  SELECT * INTO target_model FROM "AiApiModel"
  WHERE "id" = 'ai-model-griphub-minimax-m3';
  IF NOT FOUND
    OR target_model."publicId" IS DISTINCT FROM 'griphub/minimax-m3'
    OR target_model."provider" IS DISTINCT FROM 'GRIPHUB'
    OR target_model."upstreamModelId" IS DISTINCT FROM 'minimax-m3'
    OR target_model."enabled" IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'AI API floor migration: unsupported target model mapping or enablement';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "AiApiProviderHealth"
    WHERE "modelId" = target_model."id"
      AND "breakerState" = 'OPEN' AND "healthyUntil" IS NULL
  ) THEN
    RAISE EXCEPTION 'AI API floor migration: target health must remain staged open';
  END IF;

  SELECT * INTO previous_price FROM "AiApiPriceVersion"
  WHERE "id" = 'ai-price-griphub-minimax-m3-v1';
  IF NOT FOUND
    OR previous_price."modelId" IS DISTINCT FROM target_model."id"
    OR previous_price."version" IS DISTINCT FROM 1
    OR previous_price."currency" IS DISTINCT FROM 'IDR'
    OR previous_price."upstreamInputMicrosPerMillion" IS DISTINCT FROM 150000000::BIGINT
    OR previous_price."upstreamOutputMicrosPerMillion" IS DISTINCT FROM 150000000::BIGINT
    OR previous_price."retailInputMicrosPerMillion" IS DISTINCT FROM 225000000::BIGINT
    OR previous_price."retailOutputMicrosPerMillion" IS DISTINCT FROM 225000000::BIGINT
    OR previous_price."upstreamMinimumMicros" IS DISTINCT FROM 0::BIGINT
    OR previous_price."retailMinimumMicros" IS DISTINCT FROM 0::BIGINT
    OR previous_price."calculatorVersion" IS DISTINCT FROM 'text-token-v1'
    OR previous_price."sourceVersion" IS DISTINCT FROM 'GRIPHUB-catalog-and-contract-2026-10-21'
    OR previous_price."verifiedAt" IS NULL
    OR NOT isfinite(previous_price."verifiedAt")
    OR NOT isfinite(previous_price."effectiveFrom")
    OR previous_price."effectiveTo" IS NOT NULL
    OR (SELECT count(*) FROM "AiApiPriceVersion" WHERE "modelId" = target_model."id") <> 1
    OR EXISTS (SELECT 1 FROM "AiApiPriceVersion" WHERE "id" = 'ai-price-griphub-minimax-m3-v2')
  THEN
    RAISE EXCEPTION 'AI API floor migration: unsupported target price history';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "AiApiRequest"
    WHERE "priceVersionId" = previous_price."id" OR "modelId" = target_model."id"
  ) THEN
    RAISE EXCEPTION 'AI API floor migration: target v1 has referenced requests';
  END IF;

  -- CURRENT_TIMESTAMP may be shared by pending migrations. Truncate the live clock
  -- to storage precision, and advance at least one millisecond beyond v1's start.
  boundary := GREATEST(date_trunc('milliseconds', clock_timestamp()::timestamp),
                       previous_price."effectiveFrom" + INTERVAL '1 millisecond');
  UPDATE "AiApiPriceVersion"
  SET "effectiveTo" = boundary
  WHERE "id" = previous_price."id";

  -- Evidence is only the user's 2026-10-22 MiniMax M3 Base-routing billing detail.
  -- Do not infer cache pricing, other routing modes, Terra/Sol, SEKAI or image floors.
  INSERT INTO "AiApiPriceVersion" (
    "id", "modelId", "version", "currency",
    "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion",
    "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion",
    "upstreamMinimumMicros", "retailMinimumMicros", "calculatorVersion",
    "sourceVersion", "verifiedAt", "effectiveFrom", "effectiveTo", "createdAt"
  ) VALUES (
    'ai-price-griphub-minimax-m3-v2', target_model."id", 2, 'IDR',
    previous_price."upstreamInputMicrosPerMillion", previous_price."upstreamOutputMicrosPerMillion",
    previous_price."retailInputMicrosPerMillion", previous_price."retailOutputMicrosPerMillion",
    3000000, 4500000, 'text-token-floor-v2',
    'GRIPHUB-operator-attested-pending-receipt-2026-10-22-Base-routing',
    NULL, boundary, NULL, clock_timestamp()
  );
END;
$$;

-- No enablement/health mutation, request rewrite, ledger write or automatic repair.
COMMIT;
