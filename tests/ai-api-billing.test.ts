import { describe, expect, it } from "vitest";
import { calculateChargeMicros, calculateReservationMicros, ceilDiv } from "@/lib/ai-api/billing";

describe("AI API exact micro-rupiah billing", () => {
  it("applies the MiniMax per-request floor once instead of adding it to token cost", () => {
    expect(calculateChargeMicros({ promptTokens: 186n, completionTokens: 8n, inputMicrosPerMillion: 150_000_000n, outputMicrosPerMillion: 150_000_000n, minimumChargeMicros: 3_000_000n })).toBe(3_000_000n);
    expect(calculateChargeMicros({ promptTokens: 186n, completionTokens: 8n, inputMicrosPerMillion: 225_000_000n, outputMicrosPerMillion: 225_000_000n, minimumChargeMicros: 4_500_000n })).toBe(4_500_000n);
  });

  it("reserves at least the request floor even for a small completion limit", () => {
    expect(calculateReservationMicros({ inputTokenUpperBound: 400n, maxCompletionTokens: 128n, inputMicrosPerMillion: 225_000_000n, outputMicrosPerMillion: 225_000_000n, minimumChargeMicros: 4_500_000n })).toBe(4_500_000n);
  });

  it("does not add a floor above the threshold, including exact equality and zero-token success", () => {
    const rates = { inputMicrosPerMillion: 225_000_000n, outputMicrosPerMillion: 225_000_000n, minimumChargeMicros: 4_500_000n };
    expect(calculateChargeMicros({ ...rates, promptTokens: 20_000n, completionTokens: 0n })).toBe(4_500_000n);
    expect(calculateChargeMicros({ ...rates, promptTokens: 20_000n, completionTokens: 1n })).toBe(4_500_225n);
    expect(calculateChargeMicros({ ...rates, promptTokens: 0n, completionTokens: 0n })).toBe(4_500_000n);
    expect(calculateChargeMicros({ ...rates, minimumChargeMicros: 0n, promptTokens: 186n, completionTokens: 8n })).toBe(43_650n);
  });

  it.each([-1n, 9_223_372_036_854_775_808n])("rejects invalid floor %s before billing or reserving", (minimumChargeMicros) => {
    const rates = { inputMicrosPerMillion: 1n, outputMicrosPerMillion: 1n, minimumChargeMicros };
    expect(() => calculateChargeMicros({ ...rates, promptTokens: 1n, completionTokens: 0n })).toThrow();
    expect(() => calculateReservationMicros({ ...rates, inputTokenUpperBound: 1n, maxCompletionTokens: 0n })).toThrow();
  });

  it("charges input and output separately with one final ceiling", () => {
    expect(calculateChargeMicros({
      promptTokens: 10_000n,
      completionTokens: 2_000n,
      inputMicrosPerMillion: 2_500_000_000n,
      outputMicrosPerMillion: 5_000_000_000n,
      minimumChargeMicros: 0n,
    })).toBe(35_000_000n);
  });

  it("preserves fractional rupiah and rounds the final micro amount upward", () => {
    expect(ceilDiv(3n, 1_000_000n)).toBe(1n);
    expect(calculateChargeMicros({
      promptTokens: 1n,
      completionTokens: 0n,
      inputMicrosPerMillion: 1n,
      outputMicrosPerMillion: 0n,
      minimumChargeMicros: 0n,
    })).toBe(1n);
  });

  it("reserves a conservative input upper bound plus requested output", () => {
    expect(calculateReservationMicros({
      inputTokenUpperBound: 12_000n,
      maxCompletionTokens: 4_000n,
      inputMicrosPerMillion: 2_500_000_000n,
      outputMicrosPerMillion: 5_000_000_000n,
      minimumChargeMicros: 0n,
    })).toBe(50_000_000n);
  });

  it("rejects negative counters and invalid rates", () => {
    expect(() => calculateChargeMicros({ promptTokens: -1n, completionTokens: 0n, inputMicrosPerMillion: 1n, outputMicrosPerMillion: 1n, minimumChargeMicros: 0n })).toThrow();
    expect(() => calculateChargeMicros({ promptTokens: 1n, completionTokens: 0n, inputMicrosPerMillion: -1n, outputMicrosPerMillion: 1n, minimumChargeMicros: 0n })).toThrow();
  });
});
