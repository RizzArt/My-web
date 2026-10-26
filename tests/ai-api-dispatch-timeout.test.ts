import { beforeEach, describe, expect, it, vi } from "vitest";
// Unit-only policy seam for the retained generic lifecycle/health engine.
// Release-policy denial is tested unmocked in ai-api-retirement-*.test.ts.
// This admits only the historical fixture, never a real Griphub configuration.
vi.mock("@/lib/ai-api/provider-policy", () => ({ customerBillingProviderAdmitted: (provider: string) => provider === "SEKAI" }));

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  acquireLock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/ai-api/provider-health", () => ({ acquireAiApiProviderAdmissionLock: mocks.acquireLock }));

import { markAiApiDispatching } from "@/lib/ai-api/service";

describe("AI API dispatch admission", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
    mocks.acquireLock.mockReset().mockResolvedValue(undefined);
  });

  it("waits long enough for the bounded provider-health lock holder before dispatching", async () => {
    const tx = {
      $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => [{ id: String(values[0]) }]),
      aiApiKey: { findUnique: vi.fn(async () => ({ id: "key-1", walletId: "wallet-1", status: "ACTIVE", expiresAt: null, wallet: { isFrozen: false, user: { isActive: true } } })) },
      aiApiRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "request-1",
          status: "RESERVED",
          modelId: "model-1", apiKeyId: "key-1", walletId: "wallet-1",
          model: { provider: "SEKAI", enabled: true, providerHealth: { breakerState: "CLOSED", healthyUntil: new Date("2026-10-22T00:00:00.000Z") } },
        }),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mocks.transaction.mockImplementation(async (work, options) => {
      expect(options).toMatchObject({ timeout: 20_000 });
      return work(tx);
    });

    await expect(markAiApiDispatching("request-1", new Date("2026-10-21T00:00:00.000Z"))).resolves.toBeUndefined();
    expect(mocks.acquireLock).toHaveBeenCalledWith(tx);
    expect(tx.aiApiRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "request-1", status: "RESERVED" } }));
  });
});
