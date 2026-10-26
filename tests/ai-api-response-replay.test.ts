import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateAiApiResponseReplay, decryptAiApiResponseReplay, encryptAiApiResponseReplay } from "@/lib/ai-api/response-replay";

afterEach(() => vi.unstubAllEnvs());

describe("AI API encrypted response replay", () => {
  const binding = { requestId: "req_1", apiKeyId: "key_1", walletId: "wallet_1", endpoint: "responses", requestFingerprint: "fingerprint_1" };

  it("round-trips a bounded response without storing plaintext", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    const response = { id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "private output" }] }] };
    const encrypted = encryptAiApiResponseReplay(response, binding, new Date("2026-10-18T12:00:00Z"));
    expect(encrypted.ciphertext).not.toContain("private output");
    expect(encrypted.expiresAt.toISOString()).toBe("2026-10-19T12:00:00.000Z");
    expect(decryptAiApiResponseReplay(encrypted.ciphertext, encrypted.expiresAt, binding, new Date("2026-10-19T11:59:00Z"))).toEqual(response);
  });

  it("fails closed for expired, tampered, or transplanted replay state", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    const encrypted = encryptAiApiResponseReplay({ ok: true }, binding, new Date("2026-10-18T12:00:00Z"));
    expect(() => decryptAiApiResponseReplay(encrypted.ciphertext, encrypted.expiresAt, binding, new Date("2026-10-19T12:00:00Z"))).toThrow("Replay respons tidak tersedia.");
    const parts = encrypted.ciphertext.split(".");
    const tamperedPayload = Buffer.from(parts[3], "base64url");
    tamperedPayload[0] ^= 1;
    const tampered = [parts[0], parts[1], parts[2], tamperedPayload.toString("base64url")].join(".");
    expect(tampered).not.toBe(encrypted.ciphertext);
    expect(() => decryptAiApiResponseReplay(tampered, encrypted.expiresAt, binding, new Date("2026-10-18T12:10:00Z"))).toThrow("Replay respons tidak tersedia.");
    expect(() => decryptAiApiResponseReplay(encrypted.ciphertext, new Date("2026-10-21T12:00:00Z"), binding, new Date("2026-10-20T12:00:00Z"))).toThrow("Replay respons tidak tersedia.");
    expect(() => decryptAiApiResponseReplay(encrypted.ciphertext, encrypted.expiresAt, { ...binding, requestId: "req_2" }, new Date("2026-10-18T12:10:00Z"))).toThrow("Replay respons tidak tersedia.");
  });

  it("authenticates the replay envelope before applying the TTL decision", () => {
    vi.stubEnv("RIEZZ99_REQUEST_FINGERPRINT_SECRET", "test-fingerprint-secret-with-length");
    const response = { ok: true };
    const encrypted = encryptAiApiResponseReplay(response, binding, new Date("2026-10-18T12:00:00Z"));
    expect(authenticateAiApiResponseReplay(encrypted.ciphertext, encrypted.expiresAt, binding)).toEqual(response);
    expect(() => decryptAiApiResponseReplay(encrypted.ciphertext, encrypted.expiresAt, binding, encrypted.expiresAt)).toThrow("Replay respons tidak tersedia.");
  });
});
