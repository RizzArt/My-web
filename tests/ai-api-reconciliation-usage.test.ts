import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    aiApiRequest: { findUnique: vi.fn(), update: vi.fn() },
    aiApiConcurrencyLease: { updateMany: vi.fn() },
    aiApiProviderHealth: { update: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { AiApiError, finalizeAiApiRequest, markAiApiReconciliationRequired, releaseAiApiRequest } from "@/lib/ai-api/service";

describe("AI API trusted reconciliation evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.aiApiRequest.update.mockResolvedValue({});
    mocks.tx.aiApiConcurrencyLease.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.aiApiProviderHealth.update.mockResolvedValue({});
    mocks.tx.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true });
  });

  it("persists authoritative usage and replay evidence when a post-provider step fails", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({ status: "DISPATCHING", modelId: "model_1" });

    await markAiApiReconciliationRequired("req_1", "FINALIZATION_FAILED", {
      providerRequestId: "provider_1",
      promptTokens: 123n,
      completionTokens: 45n,
      responseReplayCiphertext: "v1.bound.ciphertext",
      responseReplayExpiresAt: new Date("2026-10-20T12:00:00Z"),
    });

    expect(mocks.tx.aiApiRequest.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: expect.objectContaining({
        status: "RECONCILIATION_REQUIRED",
        safeErrorCode: "FINALIZATION_FAILED",
        providerRequestId: "provider_1",
        promptTokens: 123n,
        completionTokens: 45n,
        responseReplayCiphertext: "v1.bound.ciphertext",
        responseReplayExpiresAt: new Date("2026-10-20T12:00:00Z"),
      }),
    });
  });

  it("rejects operator usage that differs from stored authoritative usage in reconciliation", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "RECONCILIATION_REQUIRED",
      promptTokens: 123n,
      completionTokens: 45n,
      providerRequestId: "provider_1",
      reservedMicros: 1_000n,
      walletId: "wallet_1",
      apiKeyId: "key_1",
      modelId: "model_1",
      admissionDate: new Date("2026-10-19T00:00:00Z"),
      wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
      priceVersion: {
        upstreamMinimumMicros: 0n,
        retailMinimumMicros: 0n,
        retailInputMicrosPerMillion: 1_000n,
        retailOutputMicrosPerMillion: 2_000n,
        upstreamInputMicrosPerMillion: 500n,
        upstreamOutputMicrosPerMillion: 1_000n,
      },
    });

    const error = await finalizeAiApiRequest({
      requestId: "req_1",
      promptTokens: 124n,
      completionTokens: 45n,
      recoveryOnly: true,
      actorId: "admin_1",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "trusted_usage_mismatch", requestStatus: "RECONCILIATION_REQUIRED" });
  });

  it("rejects recovery finalization when authoritative provider usage was never persisted", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "RECONCILIATION_REQUIRED",
      promptTokens: null,
      completionTokens: null,
      providerRequestId: null,
      reservedMicros: 1_000n,
      walletId: "wallet_1",
      apiKeyId: "key_1",
      modelId: "model_1",
      admissionDate: new Date("2026-10-19T00:00:00Z"),
      wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
      priceVersion: {
        upstreamMinimumMicros: 0n,
        retailMinimumMicros: 0n,
        retailInputMicrosPerMillion: 1_000n,
        retailOutputMicrosPerMillion: 2_000n,
        upstreamInputMicrosPerMillion: 500n,
        upstreamOutputMicrosPerMillion: 1_000n,
      },
    });

    const error = await finalizeAiApiRequest({
      requestId: "req_1",
      promptTokens: 0n,
      completionTokens: 0n,
      providerRequestId: "operator_supplied",
      recoveryOnly: true,
      actorId: "admin_1",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "authoritative_usage_required", requestStatus: "RECONCILIATION_REQUIRED" });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });

  it("rejects ordinary financial finalization without an authoritative provider identity", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "DISPATCHING",
      promptTokens: null,
      completionTokens: null,
      providerRequestId: null,
      reservedMicros: 1_000n,
      walletId: "wallet_1",
      apiKeyId: "key_1",
      modelId: "model_1",
      admissionDate: new Date("2026-10-19T00:00:00Z"),
      wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
      priceVersion: {
        upstreamMinimumMicros: 0n,
        retailMinimumMicros: 0n,
        retailInputMicrosPerMillion: 1_000n,
        retailOutputMicrosPerMillion: 2_000n,
        upstreamInputMicrosPerMillion: 500n,
        upstreamOutputMicrosPerMillion: 1_000n,
      },
    });

    const error = await finalizeAiApiRequest({
      requestId: "req_1",
      promptTokens: 123n,
      completionTokens: 45n,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "authoritative_provider_identity_required", requestStatus: "DISPATCHING" });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });

  it("rejects conflicting evidence on an already completed recovery retry", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "COMPLETED",
      promptTokens: 123n,
      completionTokens: 45n,
      providerRequestId: "provider_original",
      finalChargeMicros: 999n,
      reservedMicros: 1_000n,
      wallet: { availableMicros: 10_000n, reservedMicros: 0n, ledgerSequence: 2n },
      priceVersion: {
        upstreamMinimumMicros: 0n,
        retailMinimumMicros: 0n,
        retailInputMicrosPerMillion: 1_000n,
        retailOutputMicrosPerMillion: 2_000n,
        upstreamInputMicrosPerMillion: 500n,
        upstreamOutputMicrosPerMillion: 1_000n,
      },
    });

    const error = await finalizeAiApiRequest({
      requestId: "req_1",
      promptTokens: 0n,
      completionTokens: 0n,
      providerRequestId: "provider_other",
      recoveryOnly: true,
      actorId: "admin_1",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "trusted_usage_mismatch", requestStatus: "COMPLETED" });
  });

  it.each(["RECONCILIATION_REQUIRED", "MANUAL_REVIEW"])("rejects RELEASE_UNBILLED for %s requests with authoritative execution evidence", async (status) => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1", status, promptTokens: 123n, completionTokens: 45n, providerRequestId: "provider_1",
      responseReplayCiphertext: "v1.bound.ciphertext", reservedMicros: 1_000n,
      wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
    });

    const error = await releaseAiApiRequest("req_1", "ADMIN_CONFIRMED_UNBILLED", new Date(), { recoveryOnly: true, actorId: "admin_1" }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "authoritative_usage_requires_finalization", requestStatus: status });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });

  it("requires a durable evidence reference before an operator can release a request as unbilled", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1", status: "RECONCILIATION_REQUIRED", promptTokens: null, completionTokens: null, responseReplayCiphertext: null,
      reservedMicros: 1_000n, wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
    });

    const error = await releaseAiApiRequest("req_1", "ADMIN_CONFIRMED_UNBILLED", new Date(), { recoveryOnly: true, actorId: "admin_1" }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "unbilled_evidence_required" });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });

  it("rejects an operator provider request ID that conflicts with stored provider evidence", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1", status: "RECONCILIATION_REQUIRED", promptTokens: 123n, completionTokens: 45n, providerRequestId: "provider_original",
      reservedMicros: 1_000n, walletId: "wallet_1", apiKeyId: "key_1", modelId: "model_1", admissionDate: new Date("2026-10-19T00:00:00Z"),
      wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
      priceVersion: { upstreamMinimumMicros: 0n, retailMinimumMicros: 0n, retailInputMicrosPerMillion: 1_000n, retailOutputMicrosPerMillion: 2_000n, upstreamInputMicrosPerMillion: 500n, upstreamOutputMicrosPerMillion: 1_000n },
    });

    const error = await finalizeAiApiRequest({ requestId: "req_1", promptTokens: 123n, completionTokens: 45n, providerRequestId: "provider_other", recoveryOnly: true, actorId: "admin_1" }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "provider_request_id_mismatch", requestStatus: "RECONCILIATION_REQUIRED" });
  });

  it("rejects a repeated reconciliation write that conflicts with persisted authoritative evidence", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      status: "RECONCILIATION_REQUIRED", modelId: "model_1", providerRequestId: "provider_original",
      promptTokens: 123n, completionTokens: 45n, responseReplayCiphertext: "cipher_original",
      responseReplayExpiresAt: new Date("2026-10-20T12:00:00Z"),
    });

    const error = await markAiApiReconciliationRequired("req_1", "FINALIZATION_FAILED", {
      providerRequestId: "provider_other", promptTokens: 999n, completionTokens: 45n,
      responseReplayCiphertext: "cipher_other", responseReplayExpiresAt: new Date("2026-10-21T12:00:00Z"),
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "authoritative_evidence_mismatch", requestStatus: "RECONCILIATION_REQUIRED" });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });

  it("requires a current active admin inside the recovery transaction", async () => {
    mocks.tx.aiApiRequest.findUnique.mockResolvedValue({
      id: "req_1", status: "RECONCILIATION_REQUIRED", promptTokens: null, completionTokens: null, responseReplayCiphertext: null,
      reservedMicros: 1_000n, wallet: { availableMicros: 10_000n, reservedMicros: 1_000n, ledgerSequence: 1n },
    });
    const missingActor = await releaseAiApiRequest("req_1", "ADMIN_CONFIRMED_UNBILLED", new Date(), {
      recoveryOnly: true, unbilledEvidenceReference: "ticket:unbilled-1",
    }).catch((value: unknown) => value);
    expect(missingActor).toBeInstanceOf(AiApiError);
    expect(missingActor).toMatchObject({ code: "recovery_actor_required" });

    mocks.tx.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: false });
    const revokedActor = await releaseAiApiRequest("req_1", "ADMIN_CONFIRMED_UNBILLED", new Date(), {
      recoveryOnly: true, actorId: "admin_1", unbilledEvidenceReference: "ticket:unbilled-1",
    }).catch((value: unknown) => value);
    expect(revokedActor).toBeInstanceOf(AiApiError);
    expect(revokedActor).toMatchObject({ code: "recovery_actor_invalid" });
    expect(mocks.tx.aiApiRequest.update).not.toHaveBeenCalled();
  });
});
