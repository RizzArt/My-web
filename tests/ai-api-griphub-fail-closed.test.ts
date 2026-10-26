import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { aiApiProviderHealth: { updateMany: mocks.updateMany } },
}));

import { emergencyQuarantineAiApiAdmission } from "@/lib/ai-api/service";

afterEach(() => vi.clearAllMocks());

describe("AI API provider-agnostic fail-closed quarantine", () => {
  it("opens every enabled provider breaker when durable billing evidence cannot be written", async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });

    await emergencyQuarantineAiApiAdmission("request-griphub-1", "BILLING_STATE_UNCONFIRMED");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { model: { enabled: true } },
      data: {
        breakerState: "OPEN",
        healthyUntil: null,
        safeReasonCode: "BILLING_STATE_UNCONFIRMED",
      },
    });
  });
});
