import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiApiKey: { findMany: mocks.candidates }, $transaction: mocks.transaction } }));
import { createApiKey } from "@/lib/ai-api/api-keys";
import { acquireAiApiIngressAdmission, authenticateAiApiKey, reserveAiApiRequest } from "@/lib/ai-api/service";

const generated = createApiKey();
function keyFixture(active = true) {
  return { id: "tenant-key", walletId: "tenant-wallet", status: "ACTIVE", expiresAt: null,
    secretHash: generated.secretHash, dailySpendLimitMicros: 100_000_000n, rateLimitPerMinute: 60, concurrencyLimit: 2,
    wallet: { id: "tenant-wallet", userId: "tenant-user", isFrozen: false, user: { isActive: active } } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.candidates.mockResolvedValue([keyFixture()]); });

describe("API bearer account status", () => {
  it("rejects an owner banned after ingress before any financial reservation", async () => {
    const auth = await authenticateAiApiKey(generated.plaintext);
    const tx = {
      aiApiKey: { findUnique: vi.fn(async () => keyFixture(false)) },
      aiApiModel: { findUnique: vi.fn(async () => null) },
      aiApiRequest: { findUnique: vi.fn(async () => null), create: vi.fn() },
      aiApiWallet: { update: vi.fn() }, aiApiLedgerEntry: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(reserveAiApiRequest({ auth, request: { model: "minimax/minimax-m3", messages: [{ role: "user", content: "safe fixture" }], maxCompletionTokens: 32 }, idempotencyKey: "tenant-ban-fixture", fingerprint: "fixture" })).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    expect(tx.aiApiModel.findUnique).not.toHaveBeenCalled();
    expect(tx.aiApiRequest.create).not.toHaveBeenCalled();
    expect(tx.aiApiWallet.update).not.toHaveBeenCalled();
    expect(tx.aiApiLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects a ban observed after authentication before creating ingress counters or a lease", async () => {
    const auth = await authenticateAiApiKey(generated.plaintext);
    const tx = {
      aiApiKey: { findUnique: vi.fn(async () => keyFixture(false)) },
      aiApiConcurrencyLease: { count: vi.fn(async () => 0) },
      aiApiIngressLease: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "ingress-fixture" })) },
      aiApiRateWindow: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
      aiApiWalletRateWindow: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(acquireAiApiIngressAdmission(auth)).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    expect(tx.aiApiIngressLease.create).not.toHaveBeenCalled();
    expect(tx.aiApiRateWindow.upsert).not.toHaveBeenCalled();
    expect(tx.aiApiWalletRateWindow.upsert).not.toHaveBeenCalled();
  });

  it("rejects an inactive owner even when the bearer key remains ACTIVE", async () => {
    mocks.candidates.mockResolvedValue([keyFixture(false)]);
    await expect(authenticateAiApiKey(generated.plaintext)).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
  });
});
