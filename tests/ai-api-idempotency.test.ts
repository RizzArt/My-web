import { afterEach, describe, expect, it, vi } from "vitest";
import { requestFingerprint, validateIdempotencyKey } from "@/lib/ai-api/idempotency";

afterEach(() => vi.unstubAllEnvs());

describe("AI API client idempotency", () => {
  it("creates the same HMAC fingerprint for canonical equivalent requests", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    const first = requestFingerprint({ model: "minimax/minimax-m3", messages: [{ role: "user", content: "Halo" }], maxCompletionTokens: 128 });
    const second = requestFingerprint({ maxCompletionTokens: 128, messages: [{ content: "Halo", role: "user" }], model: "minimax/minimax-m3" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("Halo");
  });

  it("changes when any billing or output semantic changes", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    const base = { model: "minimax/minimax-m3", messages: [{ role: "user", content: "Halo" }], maxCompletionTokens: 128 };
    expect(requestFingerprint(base)).not.toBe(requestFingerprint({ ...base, maxCompletionTokens: 129 }));
    expect(requestFingerprint(base)).not.toBe(requestFingerprint({ ...base, messages: [{ role: "user", content: "Berbeda" }] }));
  });

  it("rejects excessively deep JSON before recursive fingerprinting can exhaust the stack", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    let value: unknown = "leaf";
    for (let index = 0; index < 200; index += 1) value = { nested: value };
    expect(() => requestFingerprint(value)).toThrow("Struktur request terlalu dalam.");
  });

  it("requires a bounded opaque key", () => {
    expect(validateIdempotencyKey("request-12345678")).toBe("request-12345678");
    expect(() => validateIdempotencyKey("short")).toThrow();
    expect(() => validateIdempotencyKey("x".repeat(201))).toThrow();
    expect(() => validateIdempotencyKey("bad\nkey-value")).toThrow();
  });
});
