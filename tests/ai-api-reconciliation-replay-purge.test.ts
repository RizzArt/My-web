import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptAiApiResponseReplay } from "@/lib/ai-api/response-replay";

const mocks = vi.hoisted(() => ({
  aiApiRequest: { findMany: vi.fn(), updateMany: vi.fn() },
  aiApiConcurrencyLease: { updateMany: vi.fn() },
  aiApiIngressLease: { updateMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks }));
vi.mock("@/lib/ai-api/service", () => ({
  AiApiError: class AiApiError extends Error { code = "test"; },
  markAiApiReconciliationRequired: vi.fn(),
  releaseAiApiRequest: vi.fn(),
}));

import { reconcileStaleAiApiRequests } from "@/lib/ai-api/reconciliation";

const binding = {
  requestId: "req_replay_1",
  apiKeyId: "key_1",
  walletId: "wallet_1",
  endpoint: "responses",
  requestFingerprint: "fingerprint_1",
};

function replayRow(ciphertext: string, expiresAt: Date) {
  return {
    id: binding.requestId,
    apiKeyId: binding.apiKeyId,
    walletId: binding.walletId,
    endpoint: binding.endpoint,
    requestFingerprint: binding.requestFingerprint,
    responseReplayCiphertext: ciphertext,
    responseReplayExpiresAt: expiresAt,
  };
}

describe("AI API expired response replay cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    mocks.aiApiRequest.findMany.mockResolvedValue([]);
    mocks.aiApiRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.aiApiConcurrencyLease.updateMany.mockResolvedValue({ count: 0 });
    mocks.aiApiIngressLease.updateMany.mockResolvedValue({ count: 0 });
  });

  it("purges an expired replay only after authenticating its ciphertext, expiry, and request bindings", async () => {
    const encrypted = encryptAiApiResponseReplay({ ok: true }, binding, new Date("2026-10-18T12:00:00Z"));
    const now = new Date("2026-10-20T12:00:00Z");
    mocks.aiApiRequest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([replayRow(encrypted.ciphertext, encrypted.expiresAt)]);

    const result = await reconcileStaleAiApiRequests(now);

    expect(mocks.aiApiRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: binding.requestId,
        responseReplayCiphertext: encrypted.ciphertext,
        responseReplayExpiresAt: encrypted.expiresAt,
      },
      data: { responseReplayCiphertext: null, responseReplayExpiresAt: null },
    });
    expect(result).toMatchObject({ ok: true, responseReplaysPurged: 1, failed: 0 });
  });

  it("does not purge and rotates a poisoned replay when mutable expiry does not authenticate", async () => {
    const encrypted = encryptAiApiResponseReplay({ ok: true }, binding, new Date("2026-10-18T12:00:00Z"));
    const tamperedExpiry = new Date("2026-10-18T13:00:00Z");
    const now = new Date("2026-10-20T12:00:00Z");
    mocks.aiApiRequest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([replayRow(encrypted.ciphertext, tamperedExpiry)]);

    const result = await reconcileStaleAiApiRequests(now);

    expect(mocks.aiApiRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: "asc" }, { responseReplayExpiresAt: "asc" }],
      take: 100,
    }));
    expect(mocks.aiApiRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: binding.requestId,
        responseReplayCiphertext: encrypted.ciphertext,
        responseReplayExpiresAt: tamperedExpiry,
      },
      data: { updatedAt: now },
    });
    expect(result).toMatchObject({ ok: false, responseReplaysPurged: 0, failed: 1 });
  });
});
