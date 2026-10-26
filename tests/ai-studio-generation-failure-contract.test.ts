import { describe, expect, it, vi } from "vitest";
import { SekaiProviderError } from "@/lib/studio/providers/sekai";

const failedGeneration = {
  id: "cmv3ymrab000kyfr3wiv0tfwv",
  status: "FAILED",
  errorMessage: "SEKAI sedang membatasi request.",
  outputs: [],
};

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("@/lib/studio/rate-limit", () => ({ assertStudioRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/studio/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/studio/service")>(),
  createStudioGeneration: vi.fn(async () => ({ id: failedGeneration.id })),
  processStudioGeneration: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    studioGeneration: { findUniqueOrThrow: vi.fn(async () => failedGeneration) },
  },
}));

describe("AI Studio generation failure contract", () => {
  it("returns a safe top-level error together with failed history data", async () => {
    const { POST } = await import("@/app/api/studio/generations/route");
    const response = await POST(new Request("https://example.test/api/studio/generations", {
      method: "POST",
      body: JSON.stringify({
        provider: "SEKAI",
        model: "pixel/gpt-image-2",
        prompt: "safe prompt",
        aspectRatio: "1:1",
        outputCount: 1,
      }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "SEKAI sedang membatasi request.",
      generation: failedGeneration,
    });
  });

  it("uses the API error, then history error, then a stable generic fallback", async () => {
    const { generationFailureMessage } = await import("@/lib/studio/generation-error");
    expect(generationFailureMessage({ error: "SEKAI melewati batas waktu." })).toBe("SEKAI melewati batas waktu.");
    expect(generationFailureMessage({ generation: { errorMessage: "SEKAI sedang membatasi request." } })).toBe("SEKAI sedang membatasi request.");
    expect(generationFailureMessage({})).toBe("Generation gagal.");
    expect(generationFailureMessage({})).not.toBe("The string did not match the expected pattern.");
  });

  it("logs only structured SEKAI metadata", async () => {
    const { logSekaiProviderFailure } = await import("@/lib/studio/service");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSekaiProviderFailure("generation-1", "pixel/gpt-image-2", new SekaiProviderError({
      safeMessage: "Layanan generation SEKAI sedang bermasalah.", status: 502, providerRequestId: "provider-request-1", retryable: true, category: "UPSTREAM", attempt: 3,
    }));
    expect(log).toHaveBeenCalledWith("AI Studio SEKAI provider failed", {
      generationId: "generation-1", model: "pixel/gpt-image-2", attempt: 3, status: 502, category: "UPSTREAM", providerRequestId: "provider-request-1",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Authorization|prompt|base64|API_KEY/);
    log.mockRestore();
  });
});
