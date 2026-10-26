import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiKey, hashApiKey, parseApiKey, verifyApiKey } from "@/lib/ai-api/api-keys";

afterEach(() => vi.unstubAllEnvs());

describe("Riezz99 API key security", () => {
  it("reveals a high-entropy key once and persists only prefix plus digest", () => {
    vi.stubEnv("RIEZZ99_API_KEY_PEPPER", "test-pepper-with-sufficient-length");
    const created = createApiKey(() => Buffer.alloc(32, 7));
    expect(created.plaintext).toMatch(/^rz_live_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.plaintext.slice(0, 16));
    expect(created.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.secretHash).not.toContain(created.plaintext);
    expect(verifyApiKey(created.plaintext, created.secretHash)).toBe(true);
    expect(verifyApiKey(`${created.plaintext}x`, created.secretHash)).toBe(false);
  });

  it("parses only canonical Riezz99 keys and hashes with a mandatory pepper", () => {
    vi.stubEnv("RIEZZ99_API_KEY_PEPPER", "test-pepper-with-sufficient-length");
    const key = createApiKey().plaintext;
    expect(parseApiKey(`Bearer ${key}`)).toBe(key);
    expect(parseApiKey(key)).toBeNull();
    expect(parseApiKey("Bearer sk-upstream-secret")).toBeNull();
    expect(hashApiKey(key)).toHaveLength(64);
  });

  it("fails closed in production when the dedicated pepper is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIEZZ99_API_KEY_PEPPER", "");
    expect(() => hashApiKey(`rz_live_${"a".repeat(43)}`)).toThrow("RIEZZ99_API_KEY_PEPPER");
  });
});
