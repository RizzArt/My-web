import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), currentKey: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, aiApiModel: { findMany: mocks.findMany }, aiApiRequest: { findFirst: mocks.findFirst }, aiApiKey: { findUnique: mocks.currentKey } } }));
import { AI_API_CATALOG, LEGACY_AI_API_CATALOG, catalogModel } from "@/lib/ai-api/catalog";
let api: typeof import("@/lib/ai-api/service");
import { requestFingerprint } from "@/lib/ai-api/idempotency";
import { encryptAiApiResponseReplay } from "@/lib/ai-api/response-replay";

const allIds = [...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG].map((m) => m.id);
const retiredIds = ["minimax/minimax-m3", "gemini/gemini-3.8-flash-high", "cx/gpt-5.6-sol", "cc/claude-opus-5"];
const auth = { id: "key-test", walletId: "wallet-test", dailySpendLimitMicros: 1_000_000_000n, rateLimitPerMinute: 60, concurrencyLimit: 2 };
const now = new Date();
const chat = (model: string) => ({ model, messages: [{ role: "user" as const, content: "policy fixture" }], maxCompletionTokens: 32 });
const price = { id: "price-test", verifiedAt: now, retailInputMicrosPerMillion: 225_000_000n, retailOutputMicrosPerMillion: 225_000_000n, upstreamInputMicrosPerMillion: 150_000_000n, upstreamOutputMicrosPerMillion: 150_000_000n, retailMinimumMicros: 4_500_000n, upstreamMinimumMicros: 3_000_000n };
const modelRow = (id: string) => { const c = catalogModel(id)!; return { id: `db:${id}`, publicId: id, provider: c.provider, upstreamModelId: c.upstreamModelId, maxInputTokens: c.providerMaxInputTokens, maxOutputTokens: c.providerMaxOutputTokens, privateBetaMaxOutputTokens: c.privateBetaMaxOutputTokens, maxRequestBytes: c.maxRequestBytes, enabled: true, maxExecutionSeconds: 120, createdAt: now, prices: [price], providerHealth: { breakerState: "CLOSED", healthyUntil: new Date(now.getTime() + 600_000) } }; };
let wallet: { availableMicros: bigint; reservedMicros: bigint; ledgerSequence: bigint; isFrozen: boolean; dailySpendLimitMicros: bigint; concurrencyLimit: number; rateLimitPerMinute: number };
let stored: Record<string, unknown> | null;
let tx: ReturnType<typeof makeTx>;
let writes: string[];
const write = (name: string) => vi.fn(async () => { writes.push(name); return { count: 1 }; });
function makeTx() {
  return {
    $queryRaw: vi.fn(async () => [{ locked: true }]),
    aiApiKey: { findUnique: vi.fn(async () => ({ ...auth, status: "ACTIVE", expiresAt: null, wallet: { ...wallet, user: { isActive: true } } })), update: write("key") },
    aiApiModel: { findUnique: vi.fn(async ({ where }) => modelRow(where.publicId)) },
    aiApiRequest: {
      findUnique: vi.fn(async () => stored), count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }) => { writes.push("request"); stored = { ...data, status: "RESERVED" }; }),
      updateMany: write("request-state"), update: write("request-state"),
    },
    aiApiWallet: { update: vi.fn(async ({ data }) => { writes.push("wallet"); Object.assign(wallet, data); }) },
    aiApiLedgerEntry: { create: write("ledger") },
    aiApiDailyUsage: { findUnique: vi.fn(async () => null), upsert: write("daily"), update: write("daily") },
    aiApiKeyDailyUsage: { findUnique: vi.fn(async () => null), upsert: write("key-daily"), update: write("key-daily") },
    aiApiRateWindow: { findUnique: vi.fn(async () => null), upsert: write("rate") },
    aiApiWalletRateWindow: { findUnique: vi.fn(async () => null), upsert: write("wallet-rate") },
    aiApiConcurrencyLease: { count: vi.fn(async () => 0), create: write("execution-lease"), updateMany: write("execution-lease") },
    aiApiIngressLease: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => ({ id: "ingress-test" })), update: write("ingress-transfer") },
  };
}
const snapshot = () => structuredClone({ wallet, stored, writes });
beforeEach(async () => {
  vi.resetModules();
  api = await import("@/lib/ai-api/service");
  vi.clearAllMocks(); writes = []; stored = null;
  wallet = { availableMicros: 1_000_000_000n, reservedMicros: 0n, ledgerSequence: 0n, isFrozen: false, dailySpendLimitMicros: 1_000_000_000n, concurrencyLimit: 2, rateLimitPerMinute: 60 };
  tx = makeTx(); mocks.transaction.mockImplementation(async (work: (client: typeof tx) => unknown) => work(tx));
  mocks.findMany.mockResolvedValue(allIds.map(modelRow));
  mocks.findFirst.mockImplementation(async () => stored);
  mocks.currentKey.mockImplementation(async () => ({ ...auth, status: "ACTIVE", expiresAt: null, wallet: { ...wallet, user: { isActive: true } } }));
});

describe("retired SEKAI and unverified Griphub cannot receive new API work", () => {
  it("does not list any provider despite enabled flags, verified price and fresh CLOSED health", async () => {
    await expect(api.listAvailableAiApiModels(now)).resolves.toEqual([]);
  });
  it.each(allIds)("rejects a new reservation before every financial write: %s", async (id) => {
    const before = snapshot();
    await expect(api.reserveAiApiRequest({ auth, request: chat(id), idempotencyKey: "new-policy-request", fingerprint: "new-policy-fingerprint", now })).rejects.toMatchObject({ code: "model_unavailable", httpStatus: 503 });
    expect(snapshot()).toEqual(before);
  });
  it.each(allIds)("rejects an already RESERVED request under the dispatch lock: %s", async (id) => {
    stored = { id: "old-reserved", status: "RESERVED", modelId: `db:${id}`, model: modelRow(id) };
    const before = snapshot();
    await expect(api.markAiApiDispatching("old-reserved", now)).rejects.toMatchObject({ code: "model_unavailable", requestStatus: "RESERVED" });
    expect(tx.$queryRaw).toHaveBeenCalledOnce(); expect(snapshot()).toEqual(before);
  });
  it.each(retiredIds)("rejects new inference even when a provider is injected: %s", async (id) => {
    const complete = vi.fn(); const before = snapshot();
    await expect(api.executeAiApiChat({ auth, plaintextKey: "unused-fixture-key", request: chat(id), idempotencyKey: "new-policy-request", provider: { complete } })).rejects.toMatchObject({ code: "model_unavailable" });
    expect(complete).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before);
  });
});

describe("retirement preserves historical idempotency, without opening admission", () => {
  it.each(retiredIds)("returns a duplicate historical state before applying current admission: %s", async (id) => {
    stored = { id: "historical-request", status: "RECONCILIATION_REQUIRED", requestFingerprint: "same-fingerprint" }; const before = snapshot();
    await expect(api.reserveAiApiRequest({ auth, request: chat(id), idempotencyKey: "historical-policy-request", fingerprint: "same-fingerprint", now })).resolves.toEqual({ duplicate: true, id: "historical-request", status: "RECONCILIATION_REQUIRED" });
    expect(tx.aiApiKey.findUnique).toHaveBeenCalledOnce(); expect(tx.aiApiModel.findUnique).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before);
  });
  it.each(retiredIds)("replays an authenticated completed Responses result locally: %s", async (id) => {
    const request = chat(id); const fingerprint = requestFingerprint(request);
    const response = { id: "resp_historical_fixture", object: "response", output: [] };
    const binding = { requestId: "historical-response", apiKeyId: auth.id, walletId: auth.walletId, endpoint: "responses", requestFingerprint: fingerprint };
    const replay = encryptAiApiResponseReplay(response, binding);
    stored = { id: binding.requestId, apiKeyId: auth.id, walletId: auth.walletId, endpoint: "responses", requestFingerprint: fingerprint, status: "COMPLETED", finalChargeMicros: 4_500_000n, responseReplayCiphertext: replay.ciphertext, responseReplayExpiresAt: replay.expiresAt };
    const complete = vi.fn(); const before = snapshot();
    await expect(api.executeAiApiChat({ auth, plaintextKey: "unused-fixture-key", request, endpoint: "responses", idempotencyKey: "historical-policy-response", replayCompletedResponse: true, provider: { complete } })).resolves.toMatchObject({ requestId: binding.requestId, replayed: true, response, chargeMicros: 4_500_000n });
    expect(complete).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before);
  });
  it("keeps a fingerprint mismatch a conflict before all writes", async () => {
    stored = { id: "historical-request", status: "COMPLETED", requestFingerprint: "original" }; const before = snapshot();
    await expect(api.reserveAiApiRequest({ auth, request: chat(retiredIds[0]), idempotencyKey: "historical-policy-response", fingerprint: "changed", now })).rejects.toMatchObject({ code: "idempotency_conflict", httpStatus: 409 });
    expect(snapshot()).toEqual(before);
  });
});
