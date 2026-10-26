import { beforeEach, describe, expect, it, vi } from "vitest";
// Unit-only policy seam for the retained generic lifecycle/health engine.
// Release-policy denial is tested unmocked in ai-api-retirement-*.test.ts.
// This admits only the historical fixture, never a real Griphub configuration.
vi.mock("@/lib/ai-api/provider-policy", () => ({ customerBillingProviderAdmitted: (provider: string) => provider === "SEKAI" }));

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/ai-api/provider-health", () => ({ acquireAiApiProviderAdmissionLock: mocks.lock }));

import { catalogModel } from "@/lib/ai-api/catalog";
import { executeAiApiChat, finalizeAiApiRequest, markAiApiDispatching, releaseAiApiRequest, reserveAiApiRequest } from "@/lib/ai-api/service";
import { parseResponsesRequest } from "@/lib/ai-api/responses";
import { GriphubChatProvider, GRIPHUB_CHAT_URL } from "@/lib/ai-api/providers/griphub-chat";

const now = new Date("2026-10-22T12:00:00Z");
const auth = { id: "key-1", walletId: "wallet-1", dailySpendLimitMicros: 100_000_000n, rateLimitPerMinute: 60, concurrencyLimit: 2 };
const chat = { model: "minimax/minimax-m3", messages: [{ role: "user" as const, content: "OK" }], maxCompletionTokens: 128 };
// Synthetic rates and the local unit-only policy seam test financial mechanics;
// independent real-policy tests deny both retired SEKAI and unverified Griphub.
const floorPrice = { id: "floor-price-v2", upstreamInputMicrosPerMillion: 150_000_000n, upstreamOutputMicrosPerMillion: 150_000_000n, retailInputMicrosPerMillion: 225_000_000n, retailOutputMicrosPerMillion: 225_000_000n, upstreamMinimumMicros: 3_000_000n, retailMinimumMicros: 4_500_000n };
type StoredRequest = { id: string; walletId: string; apiKeyId: string; modelId: string; priceVersionId: string; status: string; reservedMicros: bigint; requestFingerprint: string; admissionDate: Date; providerRequestId: string | null; promptTokens: bigint | null; completionTokens: bigint | null; finalChargeMicros: bigint | null; upstreamCostMicros: bigint | null };
let wallet: { availableMicros: bigint; reservedMicros: bigint; ledgerSequence: bigint; isFrozen: boolean; dailySpendLimitMicros: bigint; concurrencyLimit: number; rateLimitPerMinute: number };
let stored: StoredRequest | null;
let keyRevoked = false;
let currentPrice: typeof floorPrice;
let requestPrice: typeof floorPrice;
let tx: ReturnType<typeof makeTx>;

function makeTx() {
  const config = catalogModel(chat.model)!;
  const health = { breakerState: "CLOSED", healthyUntil: new Date("2099-01-01") };
  const model = { id: "model-1", publicId: config.id, provider: config.provider, upstreamModelId: config.upstreamModelId, maxInputTokens: config.providerMaxInputTokens, maxOutputTokens: config.providerMaxOutputTokens, privateBetaMaxOutputTokens: config.privateBetaMaxOutputTokens, maxRequestBytes: config.maxRequestBytes, maxExecutionSeconds: 120, enabled: true, providerHealth: health };
  return {
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => [{ id: String(values[0]) }]),
    aiApiKey: { findUnique: vi.fn(async () => ({ ...auth, status: keyRevoked ? "REVOKED" : "ACTIVE", expiresAt: null, wallet: { ...wallet, user: { isActive: true } } })), update: vi.fn() },
    aiApiModel: { findUnique: vi.fn(async () => ({ ...model, prices: [{ ...currentPrice }] })) },
    aiApiRequest: {
      findUnique: vi.fn(async () => stored ? { ...stored, wallet: { ...wallet }, priceVersion: { ...requestPrice }, model } : null),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }) => { requestPrice = { ...currentPrice }; stored = { ...data, status: "RESERVED", providerRequestId: null, promptTokens: null, completionTokens: null, finalChargeMicros: null, upstreamCostMicros: null }; }),
      update: vi.fn(async ({ data }) => { Object.assign(stored!, data); return stored; }),
      updateMany: vi.fn(async ({ data }) => { Object.assign(stored!, data); return { count: 1 }; }),
    },
    aiApiWallet: { update: vi.fn(async ({ data }) => { Object.assign(wallet, data); }) },
    aiApiLedgerEntry: { create: vi.fn() },
    aiApiDailyUsage: { findUnique: vi.fn(async () => null), upsert: vi.fn(), update: vi.fn() },
    aiApiKeyDailyUsage: { findUnique: vi.fn(async () => null), upsert: vi.fn(), update: vi.fn() },
    aiApiRateWindow: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    aiApiWalletRateWindow: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    aiApiConcurrencyLease: { count: vi.fn(async () => 0), create: vi.fn(), updateMany: vi.fn() },
    aiApiIngressLease: { count: vi.fn(async () => 0) },
    aiApiProviderHealth: { update: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ role: "ADMIN", isActive: true })) },
    auditLog: { create: vi.fn() },
  };
}

async function reserve() {
  return reserveAiApiRequest({ auth, request: chat, idempotencyKey: "floor-test-key", fingerprint: "floor-fingerprint", inputTokenUpperBound: 400n, now });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockReset().mockResolvedValue(undefined);
  keyRevoked = false;
  wallet = { availableMicros: 10_000_000n, reservedMicros: 0n, ledgerSequence: 0n, isFrozen: false, dailySpendLimitMicros: 100_000_000n, concurrencyLimit: 2, rateLimitPerMinute: 60 };
  stored = null;
  currentPrice = { ...floorPrice };
  requestPrice = { ...floorPrice };
  tx = makeTx();
  mocks.transaction.mockImplementation(async (work: (client: typeof tx) => unknown) => work(tx));
});

describe("versioned per-request minimum in the financial service", () => {
  it("releases a reservation exactly once when the key is revoked before dispatch, without a provider call or minimum charge", async () => {
    mocks.lock.mockImplementationOnce(async () => { keyRevoked = true; });
    const provider = { complete: vi.fn() };
    await expect(executeAiApiChat({ auth, request: chat, idempotencyKey: "revoke-before-dispatch-fixture", provider })).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(stored).toMatchObject({ status: "FAILED_RELEASED", finalChargeMicros: 0n });
    expect(wallet).toMatchObject({ availableMicros: 10_000_000n, reservedMicros: 0n, ledgerSequence: 2n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.aiApiProviderHealth.update).not.toHaveBeenCalled();
    await expect(releaseAiApiRequest(stored!.id, "retry", now, { expectedStatus: "RESERVED", openBreaker: false })).resolves.toEqual({ duplicate: true });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 64])("sends the effective reserved output cap on the wire (client cap=%s)", async (clientCap) => {
    // The existing historical test-only policy seam exercises mechanics only.
    // Real release-policy tests still deny every Griphub and retired model.
    vi.stubEnv("GRIPHUB_API_KEY", "isolated-output-cap-fixture");
    const parsed = parseResponsesRequest({ model: chat.model, input: "bounded fixture", ...(clientCap === undefined ? {} : { max_output_tokens: clientCap }) });
    const upstreamModel = catalogModel(chat.model)!.upstreamModelId;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "cap-fixture-provider-id", model: upstreamModel,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }), { headers: { "content-type": "application/json" } }));
    try {
      await executeAiApiChat({ auth, request: parsed.chatRequest, endpoint: "responses", idempotencyKey: "default-output-cap-fixture", inputTokenUpperBound: parsed.inputTokenUpperBound, provider: new GriphubChatProvider({ fetch: fetcher }) });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(GRIPHUB_CHAT_URL);
      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
      expect(body.max_tokens).toBe(parsed.chatRequest.maxCompletionTokens);
      expect(body.max_tokens).toBeGreaterThan(0);
      expect(stored).toMatchObject({ status: "COMPLETED" });
      expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([false, true])("settles the snapshotted floors exactly once (manual recovery=%s)", async (recoveryOnly) => {
    const result = await reserve();
    await markAiApiDispatching(result.id, now);
    if (recoveryOnly) Object.assign(stored!, { status: "RECONCILIATION_REQUIRED", promptTokens: 186n, completionTokens: 8n, providerRequestId: "provider-1" });
    currentPrice = { ...floorPrice, id: "later-v3", retailMinimumMicros: 9_000_000n, upstreamMinimumMicros: 6_000_000n };
    const input = { requestId: result.id, ...(recoveryOnly ? { recoveryOnly, actorId: "admin-1" } : { promptTokens: 186n, completionTokens: 8n, providerRequestId: "provider-1" }), now };
    await expect(finalizeAiApiRequest(input)).resolves.toEqual({ duplicate: false, chargeMicros: 4_500_000n });
    expect(stored).toMatchObject({ status: "COMPLETED", priceVersionId: "floor-price-v2", finalChargeMicros: 4_500_000n, upstreamCostMicros: 3_000_000n });
    expect(wallet).toMatchObject({ availableMicros: 5_500_000n, reservedMicros: 0n, ledgerSequence: 2n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ kind: "FINALIZE", reservedDeltaMicros: -4_500_000n, availableDeltaMicros: 0n }) });
    expect(tx.aiApiDailyUsage.update).toHaveBeenCalledWith(expect.objectContaining({ data: { reservedMicros: { decrement: 4_500_000n }, spentMicros: { increment: 4_500_000n } } }));
    await expect(finalizeAiApiRequest(input)).resolves.toEqual({ duplicate: true, chargeMicros: 4_500_000n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(2);
  });

  it("rejects a wallet below the floor before reservation or dispatch", async () => {
    wallet.availableMicros = 4_499_999n;
    await expect(reserve()).rejects.toThrow();
    expect(wallet.availableMicros).toBe(4_499_999n);
    expect(tx.aiApiRequest.create).not.toHaveBeenCalled();
    expect(tx.aiApiLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("releases a pre-dispatch reservation without charging a minimum and remains idempotent", async () => {
    const result = await reserve();
    await releaseAiApiRequest(result.id, "PRE_DISPATCH_FAILURE", now, { expectedStatus: "RESERVED", openBreaker: false });
    await expect(releaseAiApiRequest(result.id, "PRE_DISPATCH_FAILURE", now, { expectedStatus: "RESERVED", openBreaker: false })).resolves.toEqual({ duplicate: true });
    expect(wallet).toMatchObject({ availableMicros: 10_000_000n, reservedMicros: 0n, ledgerSequence: 2n });
    expect(stored).toMatchObject({ status: "FAILED_RELEASED", finalChargeMicros: 0n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(2);
  });

  it("preserves token-only historical price versions when their floor is zero", async () => {
    currentPrice = { ...floorPrice, id: "historical-v1", upstreamMinimumMicros: 0n, retailMinimumMicros: 0n };
    const result = await reserve();
    await markAiApiDispatching(result.id, now);
    currentPrice = { ...floorPrice };
    await expect(finalizeAiApiRequest({ requestId: result.id, promptTokens: 186n, completionTokens: 8n, providerRequestId: "legacy-provider", now })).resolves.toMatchObject({ chargeMicros: 43_650n });
    expect(stored).toMatchObject({ upstreamCostMicros: 29_100n, priceVersionId: "historical-v1" });
  });

  it("keeps an under-reserved successful request in manual review without an automatic or recovery overage debit", async () => {
    const result = await reserve();
    await markAiApiDispatching(result.id, now);
    stored!.reservedMicros = 1_000_000n;
    wallet.reservedMicros = 1_000_000n;
    wallet.availableMicros = 9_000_000n;
    await expect(finalizeAiApiRequest({ requestId: result.id, promptTokens: 186n, completionTokens: 8n, providerRequestId: "overage-provider", now })).rejects.toMatchObject({ code: "charge_exceeds_reservation" });
    expect(stored).toMatchObject({ status: "MANUAL_REVIEW", upstreamCostMicros: 3_000_000n, promptTokens: 186n, completionTokens: 8n });
    expect(wallet).toMatchObject({ reservedMicros: 1_000_000n, availableMicros: 9_000_000n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(1);
    await expect(finalizeAiApiRequest({ requestId: result.id, recoveryOnly: true, actorId: "admin-1", now })).rejects.toMatchObject({ code: "charge_exceeds_reservation" });
    expect(stored).toMatchObject({ status: "MANUAL_REVIEW", finalChargeMicros: null, upstreamCostMicros: 3_000_000n, providerRequestId: "overage-provider" });
    expect(wallet).toMatchObject({ reservedMicros: 1_000_000n, availableMicros: 9_000_000n, ledgerSequence: 1n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(tx.aiApiDailyUsage.update).not.toHaveBeenCalled();
  });

  it("reserves the retail floor once with a matching wallet and RESERVE ledger", async () => {
    const result = await reserve();
    expect(result).toMatchObject({ duplicate: false, reservation: 4_500_000n });
    expect(wallet).toMatchObject({ availableMicros: 5_500_000n, reservedMicros: 4_500_000n, ledgerSequence: 1n });
    expect(stored).toMatchObject({ priceVersionId: "floor-price-v2", reservedMicros: 4_500_000n });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "RESERVE", availableDeltaMicros: -4_500_000n, reservedDeltaMicros: 4_500_000n }) });
    await expect(reserve()).resolves.toMatchObject({ duplicate: true });
    expect(tx.aiApiLedgerEntry.create).toHaveBeenCalledTimes(1);
  });
});
