import { afterEach, describe, expect, it, vi } from "vitest";
import { AiApiError, readRequestTextWithLimit } from "@/lib/ai-api/http";
import { calculateReservationMicros } from "@/lib/ai-api/billing";
import { estimateInputTokenUpperBound } from "@/lib/ai-api/validation";

describe("AI API request body limits", () => {
  afterEach(() => vi.useRealTimers());
  it("reads a bounded streaming body", async () => {
    const request = new Request("https://api.test/v1/chat/completions", { method: "POST", body: "{\"ok\":true}" });
    await expect(readRequestTextWithLimit(request, 1024)).resolves.toBe('{"ok":true}');
  });

  it("reserves enough input tokens for observed provider-side prompt overhead", () => {
    const upperBound = estimateInputTokenUpperBound([{ role: "user", content: "Balas tepat: OK" }]);
    expect(upperBound).toBe(8_755n);
    expect(upperBound).toBeGreaterThan(2_165n);
    expect(calculateReservationMicros({
      inputTokenUpperBound: upperBound,
      maxCompletionTokens: 20n,
      inputMicrosPerMillion: 2_500_000_000n,
      outputMicrosPerMillion: 5_000_000_000n,
      minimumChargeMicros: 0n,
    })).toBe(21_987_500n);
  });

  it("cancels and rejects a chunked body as soon as it exceeds the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://api.test/v1/chat/completions", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const error = await readRequestTextWithLimit(request, 10).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "request_too_large", httpStatus: 413 });
    expect(cancelled).toBe(true);
  });

  it("cancels a slow authenticated body at the read deadline", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() { return new Promise(() => undefined); },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://api.test/v1/chat/completions", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const pending = readRequestTextWithLimit(request, 1024, 1_000).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(1_001);
    const error = await pending;
    expect(error).toBeInstanceOf(AiApiError);
    expect(error).toMatchObject({ code: "request_timeout", httpStatus: 408 });
    expect(cancelled).toBe(true);
  });
});
