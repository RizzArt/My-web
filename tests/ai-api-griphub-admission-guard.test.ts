import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { aiApiModel: { findMany: mocks.findMany } },
}));

import { listAvailableAiApiModels } from "@/lib/ai-api/service";

afterEach(() => vi.clearAllMocks());

describe("Griphub customer-admission guard", () => {
  it("does not list a manually enabled and otherwise healthy Griphub model", async () => {
    mocks.findMany.mockResolvedValue([{
      publicId: "griphub/minimax-m3",
      provider: "GRIPHUB",
      upstreamModelId: "minimax-m3",
      maxInputTokens: 32_768,
      maxOutputTokens: 512_000,
      privateBetaMaxOutputTokens: 8_192,
      maxRequestBytes: 960 * 1024,
      createdAt: new Date("2026-10-22T00:00:00.000Z"),
      prices: [{ id: "griphub-price-v1" }],
    }]);

    await expect(listAvailableAiApiModels(new Date("2026-10-22T01:00:00.000Z"))).resolves.toEqual([]);
  });
});
