import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    aiApiRequest: { findUnique: vi.fn() },
    aiApiKey: { findUnique: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
      aiApiRequest: { findFirst: vi.fn() },
      aiApiKey: { findUnique: vi.fn() },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { encryptAiApiResponseReplay } from "@/lib/ai-api/response-replay";
import { requestFingerprint } from "@/lib/ai-api/idempotency";
import { executeAiApiChat, reserveAiApiRequest } from "@/lib/ai-api/service";

function currentKey(state = "active") {
  return { id: "key_1", walletId: state === "wrong-wallet" ? "other-wallet" : "wallet_1", status: state === "revoked" ? "REVOKED" : "ACTIVE", expiresAt: state === "expired" ? new Date(0) : null,
    wallet: { isFrozen: state === "frozen", user: { isActive: state !== "banned" } } };
}
const auth = { id: "key_1", walletId: "wallet_1", dailySpendLimitMicros: 1_000_000n, rateLimitPerMinute: 10, concurrencyLimit: 2 };
const request = { model: "minimax/minimax-m3", messages: [{ role: "user" as const, content: "hello" }], maxCompletionTokens: 64 };
const replayBinding = { requestId: "req_existing", apiKeyId: "key_1", walletId: "wallet_1", endpoint: "responses", requestFingerprint: requestFingerprint(request) };

describe("AI API endpoint-scoped idempotency", () => {
  it.each(["banned", "revoked", "frozen", "expired", "wrong-wallet"])("rechecks live authority after loading ciphertext: %s", async (state) => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({ id: "req_existing", requestFingerprint: requestFingerprint(request), status: "COMPLETED" });
    mocks.prisma.aiApiKey.findUnique.mockResolvedValue(currentKey(state));
    const encrypted = encryptAiApiResponseReplay({ id: "resp_private", object: "response", output: [] }, replayBinding, new Date());
    mocks.prisma.aiApiRequest.findFirst.mockResolvedValue({ id: "req_existing", apiKeyId: auth.id, walletId: auth.walletId, endpoint: "responses", requestFingerprint: replayBinding.requestFingerprint, finalChargeMicros: 42n, responseReplayCiphertext: encrypted.ciphertext, responseReplayExpiresAt: encrypted.expiresAt });
    const provider = { complete: vi.fn() };
    await expect(executeAiApiChat({ auth, request, endpoint: "responses", idempotencyKey: "replay-checkpoint-fixture", replayCompletedResponse: true, provider })).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    expect(mocks.prisma.aiApiRequest.findFirst).toHaveBeenCalledOnce();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it.each(["banned", "revoked", "frozen", "expired", "wrong-wallet"])("rejects a completed duplicate after cached auth/ingress: %s", async (state) => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({ id: "req_existing", requestFingerprint: requestFingerprint(request), status: "COMPLETED" });
    mocks.tx.aiApiKey.findUnique.mockResolvedValue(currentKey(state));
    const encrypted = encryptAiApiResponseReplay({ id: "resp_private", object: "response", output: [] }, replayBinding, new Date());
    mocks.prisma.aiApiRequest.findFirst.mockResolvedValue({ id: "req_existing", apiKeyId: auth.id, walletId: auth.walletId, endpoint: "responses", requestFingerprint: replayBinding.requestFingerprint, finalChargeMicros: 42n, responseReplayCiphertext: encrypted.ciphertext, responseReplayExpiresAt: encrypted.expiresAt });
    const provider = { complete: vi.fn() };
    await expect(executeAiApiChat({ auth, request, endpoint: "responses", idempotencyKey: "duplicate-ban-fixture", replayCompletedResponse: true, provider })).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    expect(mocks.prisma.aiApiRequest.findFirst).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const key = { id: auth.id, walletId: auth.walletId, status: "ACTIVE", expiresAt: null, wallet: { isFrozen: false, user: { isActive: true } } };
    mocks.tx.aiApiKey.findUnique.mockReset().mockResolvedValue(key);
    mocks.prisma.aiApiKey.findUnique.mockReset().mockResolvedValue(key);
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({ id: "req_existing", requestFingerprint: "fingerprint", status: "COMPLETED" });
  });

  it("looks up a Responses request in the responses endpoint namespace", async () => {
    const result = await reserveAiApiRequest({
      auth,
      request,
      endpoint: "responses",
      idempotencyKey: "auto:12345678",
      fingerprint: "fingerprint",
    });

    expect(result).toEqual({ duplicate: true, id: "req_existing", status: "COMPLETED" });
    expect(mocks.tx.aiApiRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { apiKeyId_endpoint_idempotencyKey: { apiKeyId: "key_1", endpoint: "responses", idempotencyKey: "auto:12345678" } },
    }));
  });

  it("replays a completed Responses result without another provider call or debit", async () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({ id: "req_existing", requestFingerprint: requestFingerprint(request), status: "COMPLETED" });
    const replayedResponse = { id: "resp_existing", object: "response", status: "completed", output: [] };
    const encrypted = encryptAiApiResponseReplay(replayedResponse, replayBinding, new Date());
    mocks.prisma.aiApiRequest.findFirst.mockResolvedValue({
      id: "req_existing",
      apiKeyId: "key_1",
      walletId: "wallet_1",
      endpoint: "responses",
      requestFingerprint: replayBinding.requestFingerprint,
      finalChargeMicros: 42n,
      responseReplayCiphertext: encrypted.ciphertext,
      responseReplayExpiresAt: encrypted.expiresAt,
    });
    const provider = { complete: vi.fn() };

    const result = await executeAiApiChat({
      auth,
      request,
      endpoint: "responses",
      idempotencyKey: "auto:12345678:abcdef12",
      fingerprintSource: request,
      replayCompletedResponse: true,
      provider,
    });

    expect(result).toEqual({ requestId: "req_existing", chargeMicros: 42n, response: replayedResponse, replayed: true });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
