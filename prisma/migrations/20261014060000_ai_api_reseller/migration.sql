BEGIN;

-- Additive Riezz99 AI API reseller domain. It is isolated from store wallet and Studio Credit.
CREATE TYPE "AiApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "AiApiRequestStatus" AS ENUM ('RESERVED', 'DISPATCHING', 'COMPLETED', 'FAILED_RELEASED', 'RECONCILIATION_REQUIRED', 'MANUAL_REVIEW');
CREATE TYPE "AiApiLedgerKind" AS ENUM ('FUND', 'RESERVE', 'FINALIZE', 'RELEASE', 'REFUND', 'ADJUSTMENT');
CREATE TYPE "AiApiBreakerState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

CREATE TABLE "AiApiWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "ledgerSequence" BIGINT NOT NULL DEFAULT 0,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 4,
    "dailySpendLimitMicros" BIGINT NOT NULL DEFAULT 100000000000,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiWallet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiWallet_available_nonnegative" CHECK ("availableMicros" >= 0),
    CONSTRAINT "AiApiWallet_reserved_nonnegative" CHECK ("reservedMicros" >= 0),
    CONSTRAINT "AiApiWallet_sequence_nonnegative" CHECK ("ledgerSequence" >= 0),
    CONSTRAINT "AiApiWallet_limits_positive" CHECK ("rateLimitPerMinute" > 0 AND "concurrencyLimit" > 0 AND "dailySpendLimitMicros" >= 0)
);

CREATE TABLE "AiApiKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "AiApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 2,
    "dailySpendLimitMicros" BIGINT NOT NULL DEFAULT 100000000000,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiApiKey_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiKey_rate_positive" CHECK ("rateLimitPerMinute" > 0),
    CONSTRAINT "AiApiKey_concurrency_positive" CHECK ("concurrencyLimit" > 0),
    CONSTRAINT "AiApiKey_daily_limit_nonnegative" CHECK ("dailySpendLimitMicros" >= 0)
);

CREATE TABLE "AiApiModel" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SEKAI',
    "upstreamModelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "privateBetaMaxOutputTokens" INTEGER NOT NULL,
    "maxRequestBytes" INTEGER NOT NULL,
    "maxExecutionSeconds" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiModel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiModel_limits_positive" CHECK ("maxInputTokens" > 0 AND "maxOutputTokens" > 0 AND "privateBetaMaxOutputTokens" > 0 AND "maxRequestBytes" > 0 AND "maxExecutionSeconds" > 0),
    CONSTRAINT "AiApiModel_private_output_bound" CHECK ("privateBetaMaxOutputTokens" <= "maxOutputTokens")
);

CREATE TABLE "AiApiPriceVersion" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "upstreamInputMicrosPerMillion" BIGINT NOT NULL,
    "upstreamOutputMicrosPerMillion" BIGINT NOT NULL,
    "retailInputMicrosPerMillion" BIGINT NOT NULL,
    "retailOutputMicrosPerMillion" BIGINT NOT NULL,
    "calculatorVersion" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiApiPriceVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiPriceVersion_version_positive" CHECK ("version" > 0),
    CONSTRAINT "AiApiPriceVersion_currency_idr" CHECK ("currency" = 'IDR'),
    CONSTRAINT "AiApiPriceVersion_rates_nonnegative" CHECK ("upstreamInputMicrosPerMillion" >= 0 AND "upstreamOutputMicrosPerMillion" >= 0 AND "retailInputMicrosPerMillion" > 0 AND "retailOutputMicrosPerMillion" > 0),
    CONSTRAINT "AiApiPriceVersion_effective_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "AiApiProviderHealth" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "breakerState" "AiApiBreakerState" NOT NULL DEFAULT 'OPEN',
    "healthyUntil" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "safeReasonCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiProviderHealth_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiProviderHealth_failures_nonnegative" CHECK ("consecutiveFailures" >= 0)
);

CREATE TABLE "AiApiRequest" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "priceVersionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL DEFAULT 'chat.completions',
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "status" "AiApiRequestStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedMicros" BIGINT NOT NULL,
    "finalChargeMicros" BIGINT,
    "upstreamCostMicros" BIGINT,
    "promptTokens" BIGINT,
    "completionTokens" BIGINT,
    "providerRequestId" TEXT,
    "upstreamIdempotencyKey" TEXT NOT NULL,
    "safeErrorCode" TEXT,
    "admissionDate" DATE NOT NULL,
    "dispatchStartedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiRequest_reservation_positive" CHECK ("reservedMicros" > 0),
    CONSTRAINT "AiApiRequest_usage_nonnegative" CHECK (("promptTokens" IS NULL OR "promptTokens" >= 0) AND ("completionTokens" IS NULL OR "completionTokens" >= 0)),
    CONSTRAINT "AiApiRequest_cost_nonnegative" CHECK (("finalChargeMicros" IS NULL OR "finalChargeMicros" >= 0) AND ("upstreamCostMicros" IS NULL OR "upstreamCostMicros" >= 0)),
    CONSTRAINT "AiApiRequest_terminal_shape" CHECK (
      ("status" = 'COMPLETED' AND "finalChargeMicros" IS NOT NULL AND "promptTokens" IS NOT NULL AND "completionTokens" IS NOT NULL AND "settledAt" IS NOT NULL)
      OR ("status" = 'FAILED_RELEASED' AND "finalChargeMicros" = 0 AND "settledAt" IS NOT NULL)
      OR ("status" IN ('RESERVED', 'DISPATCHING', 'RECONCILIATION_REQUIRED', 'MANUAL_REVIEW') AND "settledAt" IS NULL)
    )
);

CREATE TABLE "AiApiLedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "requestId" TEXT,
    "sequence" BIGINT NOT NULL,
    "kind" "AiApiLedgerKind" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "availableDeltaMicros" BIGINT NOT NULL,
    "reservedDeltaMicros" BIGINT NOT NULL,
    "availableAfterMicros" BIGINT NOT NULL,
    "reservedAfterMicros" BIGINT NOT NULL,
    "safeReasonCode" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiApiLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiLedgerEntry_sequence_positive" CHECK ("sequence" > 0),
    CONSTRAINT "AiApiLedgerEntry_after_nonnegative" CHECK ("availableAfterMicros" >= 0 AND "reservedAfterMicros" >= 0),
    CONSTRAINT "AiApiLedgerEntry_request_required" CHECK ("kind" NOT IN ('RESERVE', 'FINALIZE', 'RELEASE') OR "requestId" IS NOT NULL),
    CONSTRAINT "AiApiLedgerEntry_shape" CHECK (
      ("kind" = 'FUND' AND "availableDeltaMicros" > 0 AND "reservedDeltaMicros" = 0)
      OR ("kind" = 'RESERVE' AND "availableDeltaMicros" < 0 AND "reservedDeltaMicros" = -"availableDeltaMicros")
      OR ("kind" = 'FINALIZE' AND "availableDeltaMicros" >= 0 AND "reservedDeltaMicros" < 0 AND "availableDeltaMicros" <= -"reservedDeltaMicros")
      OR ("kind" = 'RELEASE' AND "availableDeltaMicros" > 0 AND "reservedDeltaMicros" = -"availableDeltaMicros")
      OR ("kind" = 'REFUND' AND "availableDeltaMicros" > 0 AND "reservedDeltaMicros" = 0)
      OR ("kind" = 'ADJUSTMENT' AND "availableDeltaMicros" <> 0 AND "reservedDeltaMicros" = 0 AND "safeReasonCode" IS NOT NULL)
    )
);

CREATE TABLE "AiApiDailyUsage" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "admittedRequestCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiDailyUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiDailyUsage_nonnegative" CHECK ("reservedMicros" >= 0 AND "spentMicros" >= 0 AND "admittedRequestCount" >= 0)
);

CREATE TABLE "AiApiKeyDailyUsage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "admittedRequestCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiKeyDailyUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiKeyDailyUsage_nonnegative" CHECK ("reservedMicros" >= 0 AND "spentMicros" >= 0 AND "admittedRequestCount" >= 0)
);

CREATE TABLE "AiApiRateWindow" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiRateWindow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiRateWindow_count_nonnegative" CHECK ("count" >= 0)
);

CREATE TABLE "AiApiWalletRateWindow" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiApiWalletRateWindow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiWalletRateWindow_count_nonnegative" CHECK ("count" >= 0)
);

CREATE TABLE "AiApiConcurrencyLease" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    CONSTRAINT "AiApiConcurrencyLease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiConcurrencyLease_expiry" CHECK ("expiresAt" > "acquiredAt"),
    CONSTRAINT "AiApiConcurrencyLease_release_chronology" CHECK ("releasedAt" IS NULL OR "releasedAt" >= "acquiredAt")
);

CREATE TABLE "AiApiIngressLease" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    CONSTRAINT "AiApiIngressLease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiApiIngressLease_expiry" CHECK ("expiresAt" > "acquiredAt"),
    CONSTRAINT "AiApiIngressLease_release_chronology" CHECK ("releasedAt" IS NULL OR "releasedAt" >= "acquiredAt")
);

CREATE UNIQUE INDEX "AiApiWallet_userId_key" ON "AiApiWallet"("userId");
CREATE UNIQUE INDEX "AiApiKey_secretHash_key" ON "AiApiKey"("secretHash");
CREATE UNIQUE INDEX "AiApiKey_id_walletId_key" ON "AiApiKey"("id", "walletId");
CREATE INDEX "AiApiKey_prefix_status_idx" ON "AiApiKey"("prefix", "status");
CREATE INDEX "AiApiKey_walletId_status_idx" ON "AiApiKey"("walletId", "status");
CREATE UNIQUE INDEX "AiApiModel_publicId_key" ON "AiApiModel"("publicId");
CREATE UNIQUE INDEX "AiApiModel_provider_upstreamModelId_key" ON "AiApiModel"("provider", "upstreamModelId");
CREATE INDEX "AiApiModel_enabled_idx" ON "AiApiModel"("enabled");
CREATE UNIQUE INDEX "AiApiPriceVersion_modelId_version_key" ON "AiApiPriceVersion"("modelId", "version");
CREATE UNIQUE INDEX "AiApiPriceVersion_id_modelId_key" ON "AiApiPriceVersion"("id", "modelId");
CREATE INDEX "AiApiPriceVersion_modelId_effectiveFrom_effectiveTo_idx" ON "AiApiPriceVersion"("modelId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "AiApiProviderHealth_modelId_key" ON "AiApiProviderHealth"("modelId");
CREATE UNIQUE INDEX "AiApiRequest_upstreamIdempotencyKey_key" ON "AiApiRequest"("upstreamIdempotencyKey");
CREATE UNIQUE INDEX "AiApiRequest_apiKeyId_endpoint_idempotencyKey_key" ON "AiApiRequest"("apiKeyId", "endpoint", "idempotencyKey");
CREATE UNIQUE INDEX "AiApiRequest_id_walletId_key" ON "AiApiRequest"("id", "walletId");
CREATE UNIQUE INDEX "AiApiRequest_id_apiKeyId_walletId_key" ON "AiApiRequest"("id", "apiKeyId", "walletId");
CREATE INDEX "AiApiRequest_walletId_createdAt_idx" ON "AiApiRequest"("walletId", "createdAt");
CREATE INDEX "AiApiRequest_status_updatedAt_idx" ON "AiApiRequest"("status", "updatedAt");
CREATE UNIQUE INDEX "AiApiLedgerEntry_eventKey_key" ON "AiApiLedgerEntry"("eventKey");
CREATE UNIQUE INDEX "AiApiLedgerEntry_walletId_sequence_key" ON "AiApiLedgerEntry"("walletId", "sequence");
CREATE UNIQUE INDEX "AiApiLedgerEntry_one_reserve_per_request" ON "AiApiLedgerEntry"("requestId") WHERE "kind" = 'RESERVE';
CREATE UNIQUE INDEX "AiApiLedgerEntry_one_settlement_per_request" ON "AiApiLedgerEntry"("requestId") WHERE "kind" IN ('FINALIZE', 'RELEASE');
CREATE INDEX "AiApiLedgerEntry_requestId_kind_idx" ON "AiApiLedgerEntry"("requestId", "kind");
CREATE INDEX "AiApiLedgerEntry_walletId_createdAt_idx" ON "AiApiLedgerEntry"("walletId", "createdAt");
CREATE UNIQUE INDEX "AiApiDailyUsage_walletId_usageDate_key" ON "AiApiDailyUsage"("walletId", "usageDate");
CREATE UNIQUE INDEX "AiApiKeyDailyUsage_apiKeyId_usageDate_key" ON "AiApiKeyDailyUsage"("apiKeyId", "usageDate");
CREATE INDEX "AiApiKeyDailyUsage_walletId_usageDate_idx" ON "AiApiKeyDailyUsage"("walletId", "usageDate");
CREATE UNIQUE INDEX "AiApiRateWindow_apiKeyId_windowStart_key" ON "AiApiRateWindow"("apiKeyId", "windowStart");
CREATE INDEX "AiApiRateWindow_windowStart_idx" ON "AiApiRateWindow"("windowStart");
CREATE UNIQUE INDEX "AiApiWalletRateWindow_walletId_windowStart_key" ON "AiApiWalletRateWindow"("walletId", "windowStart");
CREATE INDEX "AiApiWalletRateWindow_windowStart_idx" ON "AiApiWalletRateWindow"("windowStart");
CREATE UNIQUE INDEX "AiApiConcurrencyLease_requestId_key" ON "AiApiConcurrencyLease"("requestId");
CREATE UNIQUE INDEX "AiApiConcurrencyLease_requestId_apiKeyId_walletId_key" ON "AiApiConcurrencyLease"("requestId", "apiKeyId", "walletId");
CREATE INDEX "AiApiConcurrencyLease_apiKeyId_releasedAt_expiresAt_idx" ON "AiApiConcurrencyLease"("apiKeyId", "releasedAt", "expiresAt");
CREATE INDEX "AiApiConcurrencyLease_walletId_releasedAt_expiresAt_idx" ON "AiApiConcurrencyLease"("walletId", "releasedAt", "expiresAt");
CREATE INDEX "AiApiIngressLease_apiKeyId_releasedAt_expiresAt_idx" ON "AiApiIngressLease"("apiKeyId", "releasedAt", "expiresAt");
CREATE INDEX "AiApiIngressLease_walletId_releasedAt_expiresAt_idx" ON "AiApiIngressLease"("walletId", "releasedAt", "expiresAt");

ALTER TABLE "AiApiWallet" ADD CONSTRAINT "AiApiWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiKey" ADD CONSTRAINT "AiApiKey_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiPriceVersion" ADD CONSTRAINT "AiApiPriceVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiApiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiProviderHealth" ADD CONSTRAINT "AiApiProviderHealth_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiApiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiRequest" ADD CONSTRAINT "AiApiRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiRequest" ADD CONSTRAINT "AiApiRequest_apiKeyId_walletId_fkey" FOREIGN KEY ("apiKeyId", "walletId") REFERENCES "AiApiKey"("id", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiRequest" ADD CONSTRAINT "AiApiRequest_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiApiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiRequest" ADD CONSTRAINT "AiApiRequest_priceVersionId_modelId_fkey" FOREIGN KEY ("priceVersionId", "modelId") REFERENCES "AiApiPriceVersion"("id", "modelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiLedgerEntry" ADD CONSTRAINT "AiApiLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiLedgerEntry" ADD CONSTRAINT "AiApiLedgerEntry_requestId_walletId_fkey" FOREIGN KEY ("requestId", "walletId") REFERENCES "AiApiRequest"("id", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiLedgerEntry" ADD CONSTRAINT "AiApiLedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiDailyUsage" ADD CONSTRAINT "AiApiDailyUsage_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiKeyDailyUsage" ADD CONSTRAINT "AiApiKeyDailyUsage_apiKeyId_walletId_fkey" FOREIGN KEY ("apiKeyId", "walletId") REFERENCES "AiApiKey"("id", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiKeyDailyUsage" ADD CONSTRAINT "AiApiKeyDailyUsage_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiRateWindow" ADD CONSTRAINT "AiApiRateWindow_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "AiApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiWalletRateWindow" ADD CONSTRAINT "AiApiWalletRateWindow_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiConcurrencyLease" ADD CONSTRAINT "AiApiConcurrencyLease_requestId_apiKeyId_walletId_fkey" FOREIGN KEY ("requestId", "apiKeyId", "walletId") REFERENCES "AiApiRequest"("id", "apiKeyId", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiConcurrencyLease" ADD CONSTRAINT "AiApiConcurrencyLease_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "AiApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiConcurrencyLease" ADD CONSTRAINT "AiApiConcurrencyLease_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiIngressLease" ADD CONSTRAINT "AiApiIngressLease_apiKeyId_walletId_fkey" FOREIGN KEY ("apiKeyId", "walletId") REFERENCES "AiApiKey"("id", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApiIngressLease" ADD CONSTRAINT "AiApiIngressLease_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AiApiWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ai_api_ledger_chain_guard() RETURNS trigger AS $$
DECLARE
  wallet_row "AiApiWallet"%ROWTYPE;
  previous_row "AiApiLedgerEntry"%ROWTYPE;
BEGIN
  SELECT * INTO wallet_row FROM "AiApiWallet" WHERE "id" = NEW."walletId" FOR UPDATE;
  IF NOT FOUND
    OR NEW."sequence" <> wallet_row."ledgerSequence"
    OR NEW."availableAfterMicros" <> wallet_row."availableMicros"
    OR NEW."reservedAfterMicros" <> wallet_row."reservedMicros"
  THEN
    RAISE EXCEPTION 'AI API ledger entry does not match wallet state';
  END IF;

  SELECT * INTO previous_row FROM "AiApiLedgerEntry"
  WHERE "walletId" = NEW."walletId" AND "sequence" = NEW."sequence" - 1;
  IF FOUND THEN
    IF previous_row."availableAfterMicros" + NEW."availableDeltaMicros" <> NEW."availableAfterMicros"
      OR previous_row."reservedAfterMicros" + NEW."reservedDeltaMicros" <> NEW."reservedAfterMicros"
    THEN
      RAISE EXCEPTION 'AI API ledger delta breaks the wallet chain';
    END IF;
  ELSIF NEW."sequence" <> 1
    OR NEW."availableAfterMicros" - NEW."availableDeltaMicros" <> 0
    OR NEW."reservedAfterMicros" - NEW."reservedDeltaMicros" <> 0
  THEN
    RAISE EXCEPTION 'AI API ledger chain must begin from zero at sequence one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiApiLedgerEntry_chain_guard"
BEFORE INSERT ON "AiApiLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION ai_api_ledger_chain_guard();

CREATE OR REPLACE FUNCTION ai_api_wallet_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."ledgerSequence" = 0 THEN
    IF NEW."availableMicros" <> 0 OR NEW."reservedMicros" <> 0 THEN
      RAISE EXCEPTION 'AI API wallet sequence zero must have zero balances';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "AiApiLedgerEntry" entry
    WHERE entry."walletId" = NEW."id"
      AND entry."sequence" = NEW."ledgerSequence"
      AND entry."availableAfterMicros" = NEW."availableMicros"
      AND entry."reservedAfterMicros" = NEW."reservedMicros"
  ) THEN
    RAISE EXCEPTION 'AI API wallet state requires a matching ledger entry';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "AiApiWallet_ledger_guard"
AFTER INSERT OR UPDATE OF "availableMicros", "reservedMicros", "ledgerSequence" ON "AiApiWallet"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_api_wallet_ledger_guard();

CREATE OR REPLACE FUNCTION ai_api_request_terminal_lease_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('COMPLETED', 'FAILED_RELEASED')
    AND EXISTS (SELECT 1 FROM "AiApiConcurrencyLease" WHERE "requestId" = NEW."id" AND "releasedAt" IS NULL)
  THEN
    RAISE EXCEPTION 'terminal AI API request cannot retain an active execution lease';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "AiApiRequest_terminal_lease_guard"
AFTER INSERT OR UPDATE OF "status" ON "AiApiRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_api_request_terminal_lease_guard();

CREATE OR REPLACE FUNCTION ai_api_lease_terminal_request_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."releasedAt" IS NULL
    AND EXISTS (SELECT 1 FROM "AiApiRequest" WHERE "id" = NEW."requestId" AND "status" IN ('COMPLETED', 'FAILED_RELEASED'))
  THEN
    RAISE EXCEPTION 'active AI API execution lease cannot reference a terminal request';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "AiApiConcurrencyLease_terminal_request_guard"
AFTER INSERT OR UPDATE OF "releasedAt" ON "AiApiConcurrencyLease"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_api_lease_terminal_request_guard();

CREATE OR REPLACE FUNCTION ai_api_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI API financial history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiApiLedgerEntry_immutable"
BEFORE UPDATE OR DELETE ON "AiApiLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION ai_api_reject_mutation();

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

CREATE TRIGGER "AiApiPriceVersion_immutable"
BEFORE UPDATE OR DELETE ON "AiApiPriceVersion"
FOR EACH ROW EXECUTE FUNCTION ai_api_price_guard_mutation();

CREATE OR REPLACE FUNCTION ai_api_price_reject_overlap() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."modelId", 9917301));
  IF EXISTS (
    SELECT 1 FROM "AiApiPriceVersion" p
    WHERE p."modelId" = NEW."modelId"
      AND p."effectiveFrom" < COALESCE(NEW."effectiveTo", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < COALESCE(p."effectiveTo", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION 'AI API price ranges may not overlap';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiApiPriceVersion_no_overlap"
BEFORE INSERT ON "AiApiPriceVersion"
FOR EACH ROW EXECUTE FUNCTION ai_api_price_reject_overlap();

INSERT INTO "AiApiModel" ("id", "publicId", "provider", "upstreamModelId", "displayName", "enabled", "maxInputTokens", "maxOutputTokens", "privateBetaMaxOutputTokens", "maxRequestBytes", "maxExecutionSeconds", "createdAt", "updatedAt") VALUES
('ai-model-minimax-m3', 'minimax/minimax-m3', 'SEKAI', 'minimax/minimax-m3', 'MiniMax M3', false, 1000000, 262144, 8192, 65536, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ai-model-gemini-38-flash', 'gemini/gemini-3.8-flash-high', 'SEKAI', 'gemini/gemini-3.8-flash-high', 'Gemini 3.8 Flash', false, 1000000, 65536, 8192, 65536, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ai-model-gpt-56-sol', 'cx/gpt-5.6-sol', 'SEKAI', 'cx/gpt-5.6-sol', 'GPT-5.6 Sol', false, 1050000, 128000, 8192, 65536, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('ai-model-claude-opus-5', 'cc/claude-opus-5', 'SEKAI', 'cc/claude-opus-5', 'Claude Opus 5', false, 1000000, 128000, 8192, 65536, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Defense in depth: a fresh migration never admits billable traffic automatically.
UPDATE "AiApiModel" SET "enabled" = false;

INSERT INTO "AiApiPriceVersion" ("id", "modelId", "version", "currency", "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion", "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion", "calculatorVersion", "sourceVersion", "verifiedAt", "effectiveFrom", "createdAt") VALUES
('ai-price-minimax-m3-v1', 'ai-model-minimax-m3', 1, 'IDR', 1620000000, 3240000000, 2500000000, 5000000000, 'text-token-v1', 'SEKAI-pricing-screenshot-2026-10-14', '2026-10-13T17:00:00Z', '2026-10-13T17:00:00Z', CURRENT_TIMESTAMP),
('ai-price-gemini-38-flash-v1', 'ai-model-gemini-38-flash', 1, 'IDR', 8100000000, 16200000000, 12500000000, 25000000000, 'text-token-v1', 'SEKAI-pricing-screenshot-2026-10-14', '2026-10-13T17:00:00Z', '2026-10-13T17:00:00Z', CURRENT_TIMESTAMP),
('ai-price-gpt-56-sol-v1', 'ai-model-gpt-56-sol', 1, 'IDR', 9720000000, 64800000000, 15000000000, 100000000000, 'text-token-v1', 'SEKAI-pricing-screenshot-2026-10-14', '2026-10-13T17:00:00Z', '2026-10-13T17:00:00Z', CURRENT_TIMESTAMP),
('ai-price-claude-opus-5-v1', 'ai-model-claude-opus-5', 1, 'IDR', 40500000000, 202500000000, 62500000000, 312500000000, 'text-token-v1', 'SEKAI-pricing-screenshot-2026-10-14', '2026-10-13T17:00:00Z', '2026-10-13T17:00:00Z', CURRENT_TIMESTAMP);

INSERT INTO "AiApiProviderHealth" ("id", "modelId", "breakerState", "consecutiveFailures", "safeReasonCode", "updatedAt") VALUES
('ai-health-minimax-m3', 'ai-model-minimax-m3', 'OPEN', 0, 'NOT_LIVE_VERIFIED', CURRENT_TIMESTAMP),
('ai-health-gemini-38-flash', 'ai-model-gemini-38-flash', 'OPEN', 0, 'NOT_LIVE_VERIFIED', CURRENT_TIMESTAMP),
('ai-health-gpt-56-sol', 'ai-model-gpt-56-sol', 'OPEN', 0, 'NOT_LIVE_VERIFIED', CURRENT_TIMESTAMP),
('ai-health-claude-opus-5', 'ai-model-claude-opus-5', 'OPEN', 0, 'NOT_LIVE_VERIFIED', CURRENT_TIMESTAMP);

COMMIT;
