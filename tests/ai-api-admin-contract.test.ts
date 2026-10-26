import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminService = readFileSync(new URL("../src/lib/ai-api/admin.ts", import.meta.url), "utf8");
const keyRoute = readFileSync(new URL("../src/app/api/admin/ai-api/keys/route.ts", import.meta.url), "utf8");
const fundRoute = readFileSync(new URL("../src/app/api/admin/ai-api/fund/route.ts", import.meta.url), "utf8");
const modelsRoute = readFileSync(new URL("../src/app/api/admin/ai-api/models/route.ts", import.meta.url), "utf8");
const reconciliationRoute = readFileSync(new URL("../src/app/api/admin/ai-api/reconciliation/route.ts", import.meta.url), "utf8");
const overviewRoute = readFileSync(new URL("../src/app/api/admin/ai-api/overview/route.ts", import.meta.url), "utf8");
const legacyIntegrityMigration = readFileSync(new URL("../prisma/migrations/20261021020000_ai_api_legacy_integrity_index/migration.sql", import.meta.url), "utf8");
const legacyIntegrityIndexHelper = readFileSync(new URL("../deployment/ensure-ai-api-legacy-integrity-index.mjs", import.meta.url), "utf8");
const reconciliationJob = readFileSync(new URL("../src/app/api/internal/jobs/ai-api-reconciliation/route.ts", import.meta.url), "utf8");
const healthJob = readFileSync(new URL("../src/app/api/internal/jobs/ai-api-provider-health/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/ai-api/service.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/components/admin-ai-api-manager.tsx", import.meta.url), "utf8");
const activeAdmin = readFileSync(new URL("../src/lib/active-admin.ts", import.meta.url), "utf8");

describe("AI API private-beta administration", () => {
  it("creates hash-only keys and reveals plaintext only from the creation response", () => {
    expect(adminService).toContain("createApiKey()");
    expect(adminService).toContain("secretHash: generated.secretHash");
    expect(keyRoute).toContain("plaintext");
    expect(keyRoute).toContain("sensitiveJsonHeaders");
    expect(adminService).not.toContain("console.log");
  });

  it("funds the isolated wallet through an idempotent FUND ledger entry", () => {
    expect(fundRoute).toContain("idempotency-key");
    expect(adminService).toContain('kind: "FUND"');
    expect(adminService).toContain("eventKey: input.eventKey");
    expect(adminService).toContain("TransactionIsolationLevel.Serializable");
    expect(adminService).not.toContain("studioCredits");
    expect(adminService).not.toContain("user.balance");
    expect(adminService).toContain("AUTO_HEALTH_LIABILITY_CHANGED");
    expect(adminService).toContain('breakerState: "CLOSED"');
  });

  it("requires an admin session for both financial routes", () => {
    expect(keyRoute).toContain('session?.user.role !== "ADMIN"');
    expect(fundRoute).toContain('session?.user.role !== "ADMIN"');
    expect(keyRoute).toContain("verifyFreshAdminMfa");
    expect(fundRoute).toContain("verifyFreshAdminMfa");
    expect(modelsRoute).toContain("verifyFreshAdminMfa");
    expect(reconciliationRoute).toContain("verifyFreshAdminMfa");
  });

  it("revalidates sensitive admin GET actors against current database state", () => {
    expect(activeAdmin).toContain("isActive: true");
    expect(activeAdmin).toContain('role: "ADMIN"');
    expect(overviewRoute).toContain("requireActiveAdmin(session.user.id)");
    expect(keyRoute).toContain("requireActiveAdmin(session.user.id)");
    expect(modelsRoute).toContain("requireActiveAdmin(session.user.id)");
    expect(reconciliationRoute).toContain("requireActiveAdmin(session.user.id)");
  });

  it("provides guarded protective disable and historical manual reconciliation without direct SQL", () => {
    expect(modelsRoute).toContain("setAiApiModelAvailability");
    expect(modelsRoute).toContain("export async function POST");
    expect(modelsRoute).not.toContain("healthyForSeconds");
    expect(reconciliationRoute).toContain("settleAiApiRequestByAdmin");
    expect(reconciliationRoute).toContain('session?.user.role !== "ADMIN"');
    expect(reconciliationRoute).toContain("hasTrustedSameOrigin(request)");
    expect(reconciliationRoute).toContain("sensitiveJsonHeaders");
    expect(reconciliationRoute).toContain("upstreamIdempotencyKey");
    expect(reconciliationRoute).toContain("unbilledEvidenceReference");
    expect(reconciliationRoute).toContain("promptTokens: true");
    expect(reconciliationRoute).toContain("completionTokens: true");
    expect(reconciliationRoute).toContain("promptTokens: request.promptTokens?.toString() ?? null");
    expect(manager).toContain("Authoritative usage");
    expect(manager).not.toContain('placeholder="Prompt tokens"');
    expect(manager).not.toContain('placeholder="Completion tokens"');
    expect(adminService).toContain("unbilledEvidenceReference");
    expect(adminService).toContain("AI_API_MODEL_AVAILABILITY_CHANGED");
    expect(adminService).not.toContain("probeSekaiProviderHealth");
    expect(adminService).not.toContain("SEKAI_API_KEY");
    expect(adminService).toContain("Layanan API model ini telah dihentikan.");
    expect(adminService).toContain("kontrak billing provider terverifikasi");
    expect(adminService).toContain("data: { enabled: false }");
    expect(service).toContain("AI_API_REQUEST_RECONCILED");
  });

  it("exposes a secret-protected stale-request reconciliation job", () => {
    expect(reconciliationJob).toContain("AUTO_ACCEPT_CRON_SECRET");
    expect(reconciliationJob).toContain("reconcileStaleAiApiRequests");
    expect(reconciliationJob).toContain("timingSafeEqual");
  });

  it("exposes a separately secret-protected provider health job", () => {
    expect(healthJob).toContain("AI_API_HEALTH_CRON_SECRET");
    expect(healthJob).toContain("runAiApiProviderHealthJob");
    expect(healthJob).toContain("timingSafeEqual");
  });

  it("exposes legacy completed-request integrity debt as read-only admin evidence", () => {
    expect(overviewRoute).toContain('request."status" = \'COMPLETED\'');
    expect(overviewRoute).toContain("AiApiRequest_completed_provider_identity");
    expect(overviewRoute).toContain('conrelid = \'"AiApiRequest"\'::regclass');
    expect(overviewRoute).toContain("contype = 'c'");
    expect(overviewRoute).toContain("pg_get_constraintdef");
    expect(overviewRoute).toContain("EXPECTED_LEGACY_CONSTRAINT");
    expect(overviewRoute).toContain('ORDER BY request."createdAt" ASC, request."id" ASC LIMIT 20');
    expect(overviewRoute).toContain("FROM \"AiApiRequest\"");
    expect(overviewRoute).toContain("WHERE request.\"status\" = 'COMPLETED'");
    expect(overviewRoute).not.toContain('aiApiRequest.count({ where: { status: "COMPLETED"');
    expect(overviewRoute).toContain("legacyIntegrity");
    expect(overviewRoute).toContain("sensitiveJsonHeaders");
    expect(manager).toContain("Legacy data integrity");
    expect(manager).toContain("legacyIntegrity");
    expect(manager).not.toContain("VALIDATE CONSTRAINT");
    expect(legacyIntegrityMigration).not.toMatch(/^\s*CREATE INDEX/m);
    expect(legacyIntegrityIndexHelper).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(legacyIntegrityIndexHelper).toContain("DROP INDEX CONCURRENTLY IF EXISTS");
    expect(legacyIntegrityIndexHelper).toContain("lock_timeout=5000");
    expect(legacyIntegrityIndexHelper).toContain("indisvalid");
    expect(legacyIntegrityIndexHelper).toContain("indoption");
    expect(legacyIntegrityIndexHelper).toContain("pg_get_indexdef");
    expect(legacyIntegrityIndexHelper).toContain("pg_get_expr");
    expect(legacyIntegrityIndexHelper).not.toContain("force_custom_plan");
    expect(legacyIntegrityIndexHelper).toContain("enable_seqscan = off");
    expect(legacyIntegrityIndexHelper).toContain("AI_API_LEGACY_INDEX_DATABASE_URL");
    expect(legacyIntegrityIndexHelper).toContain("AI_API_LEGACY_INDEX_EXPECTED_DATABASE");
    expect(legacyIntegrityIndexHelper).toContain("AI_API_LEGACY_INDEX_EXPECTED_CLUSTER_IDENTITY");
    expect(legacyIntegrityIndexHelper).toContain("current_database()");
    expect(legacyIntegrityIndexHelper).toContain("\\if :target_verified");
    expect(legacyIntegrityIndexHelper).toContain("pg_try_advisory_lock");
    expect(legacyIntegrityIndexHelper).toContain('JOIN "AiApiModel" AS model');
    expect(legacyIntegrityIndexHelper).toContain("pg_postmaster_start_time()");
    expect(legacyIntegrityIndexHelper).toContain("parameter routing database tidak didukung");
    expect(legacyIntegrityIndexHelper).toContain("EXPECTED_PREDICATE.test(predicate)");
    expect(legacyIntegrityIndexHelper).toContain("PGSERVICEFILE");
    expect(legacyIntegrityIndexHelper).toContain("PGSERVICE");
    expect(legacyIntegrityIndexHelper).toContain("PRISMA_URL_PARAMETERS");
    expect(legacyIntegrityIndexHelper).toContain("search_path");
    expect(legacyIntegrityIndexHelper).toContain("escapeLibpqOptionArgument");
    expect(legacyIntegrityIndexHelper).toContain("normalizeServiceHost");
    expect(legacyIntegrityIndexHelper).toContain("statement_timeout=600000");
    expect(legacyIntegrityIndexHelper).toContain('values.set("connect_timeout", "5")');
    expect(legacyIntegrityIndexHelper).toContain("timeout: 620_000");
    expect(legacyIntegrityIndexHelper).not.toContain("PGOPTIONS");
    expect(legacyIntegrityIndexHelper).not.toContain("return `'${value");
    expect(legacyIntegrityIndexHelper).not.toContain("PGDATABASE: databaseUrl");
    expect(legacyIntegrityIndexHelper).toContain("WHERE \"status\" = 'COMPLETED' AND \"providerRequestId\" IS NULL");
  });
});
