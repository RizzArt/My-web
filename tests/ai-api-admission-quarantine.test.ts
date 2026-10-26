import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    aiApiRequest: { findUnique: vi.fn() },
    aiApiProviderHealth: { updateMany: vi.fn() },
    aiApiModel: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { acquireAiApiIngressAdmission, emergencyQuarantineAiApiAdmission, listAvailableAiApiModels } from "@/lib/ai-api/service";

const auth = { id: "key_1", walletId: "wallet_1", dailySpendLimitMicros: 1_000_000n, rateLimitPerMinute: 10, concurrencyLimit: 2 };

describe("AI API emergency admission quarantine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiApiRequest.findUnique.mockResolvedValue({ modelId: "model_1" });
    mocks.prisma.aiApiProviderHealth.updateMany.mockRejectedValue(new Error("database still unavailable"));
  });

  it("fails the current process closed even when the durable breaker write also fails", async () => {
    await emergencyQuarantineAiApiAdmission("req_1", "BILLING_STATE_UNCONFIRMED");

    await expect(acquireAiApiIngressAdmission(auth)).rejects.toMatchObject({ code: "billing_state_unconfirmed", httpStatus: 503 });
    await expect(listAvailableAiApiModels()).resolves.toEqual([]);
    expect(mocks.prisma.aiApiModel.findMany).not.toHaveBeenCalled();
  });
});
