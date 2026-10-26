import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("../src/lib/ai-api/service.ts", import.meta.url), "utf8");
const chatRoute = readFileSync(new URL("../src/app/v1/chat/completions/route.ts", import.meta.url), "utf8");
const responsesRoute = readFileSync(new URL("../src/app/v1/responses/route.ts", import.meta.url), "utf8");
const modelsRoute = readFileSync(new URL("../src/app/v1/models/route.ts", import.meta.url), "utf8");
const reconciliation = readFileSync(new URL("../src/lib/ai-api/reconciliation.ts", import.meta.url), "utf8");
const providerHealth = readFileSync(new URL("../src/lib/ai-api/provider-health.ts", import.meta.url), "utf8");
const sekaiHealth = readFileSync(new URL("../src/lib/ai-api/providers/sekai-health.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/lib/ai-api/admin.ts", import.meta.url), "utf8");
const studioService = readFileSync(new URL("../src/lib/studio/service.ts", import.meta.url), "utf8");

describe("AI API orchestration safety contract", () => {
  it("uses serializable transactions, bounded retries, and separate commits around upstream dispatch", () => {
    expect(service).toContain("TransactionIsolationLevel.Serializable");
    expect(service).toContain("P2034");
    expect(service).toContain("reserveAiApiRequest");
    expect(service).toContain("markAiApiDispatching");
    expect(service).toContain("finalizeAiApiRequest");
    expect(service).toContain("releaseAiApiRequest");
    expect(service).toContain("markAiApiReconciliationRequired");
    expect(service).not.toContain("markAiApiReconciliationRequired(reserved.id");
    expect(service).not.toContain(".catch(() => undefined)");
  });

  it("requires bearer auth and idempotency before parsing or dispatching chat", () => {
    expect(chatRoute).toContain("bearerApiKey");
    expect(chatRoute).toContain("idempotency-key");
    expect(chatRoute).toContain("executeAiApiChat");
    expect(chatRoute).toContain("streaming_not_supported");
    expect(chatRoute.indexOf("const authenticatedKey = await authenticateAiApiKey")).toBeLessThan(chatRoute.indexOf("const text = await readRequestTextWithLimit"));
    expect(chatRoute).toContain('"Terjadi kesalahan internal."');
    expect(chatRoute).toContain("acquireAiApiIngressAdmission");
    expect(chatRoute).toContain("releaseAiApiIngressAdmission");
    expect(service).toContain("ingressLeaseId");
  });

  it("supports Responses JSON and synthetic SSE through the same guarded billing lifecycle", () => {
    expect(responsesRoute).toContain("bearerApiKey");
    expect(responsesRoute.indexOf("const authenticatedKey = await authenticateAiApiKey")).toBeLessThan(responsesRoute.indexOf("const text = await readRequestTextWithLimit"));
    expect(responsesRoute).toContain("responsesIdempotencyKey");
    expect(responsesRoute).toContain('endpoint: "responses"');
    expect(responsesRoute).toContain("inputTokenUpperBound: parsed.inputTokenUpperBound");
    expect(responsesRoute).toContain("fingerprintSource: raw");
    expect(responsesRoute).toContain("responseToSse");
    expect(responsesRoute).toContain('"Content-Type": "text/event-stream"');
    expect(responsesRoute).toContain("releaseAiApiIngressAdmission");
    expect(service).toContain("input.request.tools");
    expect(service).toContain("parallelToolCalls: input.request.parallelToolCalls");
  });

  it("publishes only database-enabled and healthy models", () => {
    expect(modelsRoute).toContain("listAvailableAiApiModels");
    expect(modelsRoute).toContain("authenticateAiApiKey");
    expect(service).toContain("BLOCKING_BILLING_STATUSES");
    expect(service).toContain('["DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"]');
    expect(service).toContain("blockingBillingRequests");
    expect(service).toContain("model.provider === expectedCatalogModel.provider");
    expect(service).toContain("model.upstreamModelId === expectedCatalogModel.upstreamModelId");
    expect(service).toContain("model.maxInputTokens === expectedCatalogModel.providerMaxInputTokens");
    expect(service).toContain("model.maxOutputTokens === expectedCatalogModel.providerMaxOutputTokens");
    expect(service).toContain("model.privateBetaMaxOutputTokens === expectedCatalogModel.privateBetaMaxOutputTokens");
    expect(service).toContain("model.maxRequestBytes === expectedCatalogModel.maxRequestBytes");
    expect(admin).toContain("model.provider !== expectedCatalogModel.provider");
    expect(admin).toContain("model.upstreamModelId !== expectedCatalogModel.upstreamModelId");
    expect(admin).toContain("model.maxRequestBytes !== expectedCatalogModel.maxRequestBytes");
  });

  it("has durable stale-request recovery and never lets an ordinary success close an opened breaker", () => {
    expect(reconciliation).toContain("reconcileStaleAiApiRequests");
    expect(reconciliation).toContain('status: "RESERVED"');
    expect(reconciliation).toContain('status: "DISPATCHING"');
    expect(service).toContain('breakerState: "CLOSED"');
    expect(service).toContain("updateMany");
    expect(service).toContain('data: { lastSuccessAt: now }');
    expect(service).not.toContain('data: { breakerState: "CLOSED", healthyUntil:');
    expect(service).not.toContain("healthyUntil: new Date(now.getTime() + 5 * 60_000)");
    expect(reconciliation).toContain("if (failed > 0)");
    expect(reconciliation).toContain("RECOVERY_ATTEMPT_FAILED");
    expect(service).toContain("providerRequestId: options.providerRequestId");
    expect(reconciliation).toContain('status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] }');
    expect(reconciliation).toContain('expectedStatus: "RESERVED"');
    expect(service).toContain('expectedStatus?: "RESERVED" | "DISPATCHING"');
    expect(reconciliation).toContain('error.code === "invalid_request_state"');
    expect(reconciliation).toContain("responseReplayCiphertext: null");
    expect(reconciliation).toContain("responseReplayExpiresAt: null");
    expect(reconciliation).toContain("responseReplayExpiresAt: { lte: now }");
  });

  it("streams settled SSE events incrementally instead of materializing the whole wire body", () => {
    expect(responsesRoute).toContain("responseToSseStream");
    expect(responsesRoute).not.toContain("new Response(responseToSse(response)");
  });

  it("preserves legacy probe tests and guards rolling health without calling the retired provider", () => {
    expect(sekaiHealth).toContain("https://api.sekaigateway.xyz/v1/models");
    expect(sekaiHealth).toContain("https://api.sekaigateway.xyz/api/quota");
    expect(sekaiHealth).not.toContain("/v1/chat/completions");
    expect(providerHealth).toContain('breakerState: "CLOSED"');
    expect(providerHealth).toContain("AUTO_HEALTH_REPEATED_FAILURE");
    expect(providerHealth).toContain("model: { enabled: true }");
    expect(providerHealth).toContain('requests: { none: { status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } } }');
    expect(providerHealth).toContain("pg_try_advisory_xact_lock");
    expect(providerHealth).toContain("customerBillingProviderAdmitted(model.provider)");
    expect(providerHealth).not.toContain("process.env.SEKAI_API_KEY");
    expect(service).not.toContain("new SekaiChatProvider()");
    expect(providerHealth).toContain("SELECT TRUE AS locked FROM pg_advisory_xact_lock");
    expect(providerHealth).toContain('error.code === "P2034"');
    expect(providerHealth).toContain("attempt < 3");
  });

  it("serializes liability increases and protective disable while refusing all enablement", () => {
    expect(admin).toContain("acquireAiApiProviderAdmissionLock");
    const funding = admin.slice(admin.indexOf("export async function fundAiApiWallet"), admin.indexOf("export async function revokeAiApiKey"));
    expect(funding.indexOf("await acquireAiApiProviderAdmissionLock(tx)")).toBeGreaterThan(-1);
    expect(funding.indexOf("await acquireAiApiProviderAdmissionLock(tx)")).toBeLessThan(funding.indexOf("aiApiWallet.update"));

    const availability = admin.slice(admin.indexOf("export async function setAiApiModelAvailability"), admin.indexOf("export async function settleAiApiRequestByAdmin"));
    expect(availability.indexOf("await acquireAiApiProviderAdmissionLock(tx)")).toBeGreaterThan(-1);
    expect(availability.indexOf("await acquireAiApiProviderAdmissionLock(tx)")).toBeLessThan(availability.indexOf("aiApiModel.update"));
    const beforeTransaction = availability.slice(0, availability.indexOf("return serializable(async (tx)"));
    expect(beforeTransaction).toMatch(/if \(input.enabled\) throw new Error/);
    expect(availability).not.toContain("probeSekaiProviderHealth");
    expect(availability).not.toContain("SEKAI_API_KEY");
    expect(availability).toContain("data: { enabled: false }");
    expect(availability).toContain('breakerState: "OPEN", healthyUntil: null');
  });

  it("fails AI API admission closed while shared SEKAI Studio spending is in flight", () => {
    const processing = studioService.slice(studioService.indexOf("export async function processStudioGeneration"), studioService.indexOf("export async function creditStudioUser"));
    expect(processing).toContain("acquireAiApiProviderAdmissionLock");
    expect(processing).toContain("AUTO_HEALTH_SHARED_PROVIDER_ACTIVITY");
    expect(processing).toContain('status: { in: ["DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] }');
    expect(processing).toContain('updateMany({ where: { id: generationId, status: "PENDING" }');
    expect(processing).toContain('error.code === "P2034"');
    expect(processing).toContain("await refundGeneration(generationId");
    expect(processing.indexOf("AUTO_HEALTH_SHARED_PROVIDER_ACTIVITY")).toBeLessThan(processing.indexOf("getStudioProvider"));
    expect(providerHealth).toContain('provider: "SEKAI", status: "PROCESSING"');
    const healthJob = providerHealth.slice(providerHealth.indexOf("export async function runAiApiProviderHealthJob"));
    expect(healthJob.indexOf('provider: "SEKAI", status: "PROCESSING"')).toBeLessThan(healthJob.indexOf("refreshAiApiProviderHealth"));
    const dispatch = service.slice(service.indexOf("export async function markAiApiDispatching"), service.indexOf("export async function finalizeAiApiRequest"));
    expect(dispatch.indexOf("await acquireAiApiProviderAdmissionLock(tx)")).toBeLessThan(dispatch.indexOf('status: "DISPATCHING"'));
    expect(service).toContain("DISPATCH_SERIALIZABLE_TIMEOUT_MS");
    expect(dispatch).toContain("timeout: DISPATCH_SERIALIZABLE_TIMEOUT_MS");
  });

  it("restricts operator settlement to committed reconciliation states", () => {
    expect(service).toContain("recoveryOnly");
    expect(service).toContain('request.status === "RECONCILIATION_REQUIRED" || request.status === "MANUAL_REVIEW"');
    expect(service).toContain("Never debit beyond the reservation");
    expect(service).not.toContain("finalizeReservationWithManualOverage");
    expect(service).not.toContain("ADMIN_MANUAL_OVERAGE");
    expect(service).toContain("trusted usage tidak cocok");
    expect(service).toContain("authoritative usage belum tersedia");
  });
});
