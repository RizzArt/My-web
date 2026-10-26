import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20261014060000_ai_api_reseller/migration.sql", import.meta.url), "utf8");
const replayMigration = readFileSync(new URL("../prisma/migrations/20261019010000_ai_api_response_replay/migration.sql", import.meta.url), "utf8");

describe("AI API financial schema isolation", () => {
  it("uses a separate bigint wallet, request, key, price, and append-only ledger domain", () => {
    for (const model of ["AiApiWallet", "AiApiKey", "AiApiModel", "AiApiPriceVersion", "AiApiRequest", "AiApiLedgerEntry", "AiApiDailyUsage", "AiApiKeyDailyUsage", "AiApiWalletRateWindow", "AiApiConcurrencyLease", "AiApiIngressLease"]) expect(schema).toContain(`model ${model}`);
    expect(schema).toMatch(/model AiApiWallet[\s\S]*availableMicros\s+BigInt[\s\S]*reservedMicros\s+BigInt/);
    expect(schema).toMatch(/model AiApiLedgerEntry[\s\S]*availableDeltaMicros\s+BigInt[\s\S]*reservedDeltaMicros\s+BigInt/);
    expect(schema).not.toMatch(/balance\s+BigInt/);
  });

  it("enforces idempotency and one reserve plus one terminal settlement in PostgreSQL", () => {
    expect(schema).toContain("@@unique([apiKeyId, endpoint, idempotencyKey])");
    expect(migration).toContain('CREATE UNIQUE INDEX "AiApiLedgerEntry_one_reserve_per_request"');
    expect(migration).toContain('CREATE UNIQUE INDEX "AiApiLedgerEntry_one_settlement_per_request"');
    expect(migration).toContain("WHERE \"kind\" IN ('FINALIZE', 'RELEASE')");
  });

  it("prevents negative balances and mutation of financial history", () => {
    expect(migration).toContain('CHECK ("availableMicros" >= 0)');
    expect(migration).toContain('CHECK ("reservedMicros" >= 0)');
    expect(migration).toContain("ai_api_reject_mutation");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AiApiLedgerEntry"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AiApiPriceVersion"');
  });

  it("seeds exactly four disabled models and immutable versioned prices", () => {
    for (const id of ["minimax/minimax-m3", "gemini/gemini-3.8-flash-high", "cx/gpt-5.6-sol", "cc/claude-opus-5"]) expect(migration).toContain(id);
    expect(migration).toContain('"enabled" = false');
    expect(migration).toContain('"calculatorVersion"');
  });

  it("migrates every approved model to the exact Codex request-size contract", () => {
    expect(replayMigration).toContain('UPDATE "AiApiModel"');
    expect(replayMigration).toContain('"maxRequestBytes" = 983040');
    expect(replayMigration).toContain("AI API catalog request-size migration did not update exactly four models");
  });

  it("makes persisted provider usage and replay evidence write-once in PostgreSQL", () => {
    expect(replayMigration).toContain("ai_api_request_evidence_immutable");
    for (const field of ["providerRequestId", "promptTokens", "completionTokens", "responseReplayCiphertext", "responseReplayExpiresAt"]) {
      expect(replayMigration).toContain(`OLD.\"${field}\" IS NOT NULL`);
      expect(replayMigration).toContain(`NEW.\"${field}\" IS DISTINCT FROM OLD.\"${field}\"`);
    }
    expect(replayMigration).toContain('BEFORE UPDATE ON "AiApiRequest"');
    expect(replayMigration).toContain('OLD."responseReplayExpiresAt" <= CURRENT_TIMESTAMP');
    expect(replayMigration).toContain('NEW."responseReplayCiphertext" IS NULL');
    expect(replayMigration).toContain('NEW."responseReplayExpiresAt" IS NULL');
    expect(replayMigration).toContain('CONSTRAINT "AiApiRequest_completed_provider_identity"');
    expect(replayMigration).toContain('CHECK ("status" <> \'COMPLETED\' OR "providerRequestId" IS NOT NULL) NOT VALID');
  });

  it("applies atomically and enforces cross-wallet, price-model, actor, and lease integrity", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('"AiApiRequest_apiKeyId_walletId_fkey"');
    expect(migration).toContain('"AiApiRequest_priceVersionId_modelId_fkey"');
    expect(migration).toContain('"AiApiLedgerEntry_requestId_walletId_fkey"');
    expect(migration).toContain('"AiApiConcurrencyLease_requestId_apiKeyId_walletId_fkey"');
    expect(migration).toContain('"AiApiLedgerEntry_actorId_fkey"');
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain('CHECK ("sequence" > 0)');
    expect(migration).toContain("AiApiLedgerEntry_request_required");
    expect(migration).toContain('"releasedAt" IS NULL OR "releasedAt" >= "acquiredAt"');
    expect(migration).toContain('CREATE TABLE "AiApiIngressLease"');
    expect(migration).toContain("AiApiLedgerEntry_chain_guard");
    expect(migration).toContain("AiApiWallet_ledger_guard");
    expect(migration).toContain("AiApiRequest_terminal_lease_guard");
  });
});
