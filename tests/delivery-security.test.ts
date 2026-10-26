import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashDownloadToken, newDownloadToken } from "@/lib/security/secrets";

describe("delivery security primitives", () => {
  it("creates high-entropy download tokens and stores only their hash", () => {
    const token = newDownloadToken();
    expect(Buffer.from(token, "base64url").byteLength).toBe(32);
    expect(hashDownloadToken(token)).not.toContain(token);
    expect(hashDownloadToken(token)).toBe(hashDownloadToken(token));
  });

  it("encrypts inventory secrets at rest", () => {
    const encrypted = encryptSecret("username\npassword");
    expect(encrypted).not.toContain("password");
    expect(decryptSecret(encrypted)).toBe("username\npassword");
  });
});
