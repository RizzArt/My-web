import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientRateLimitIdentity, trustedClientIp } from "@/lib/trusted-client-ip";
import { hashRateLimitKey, LOGIN_FAILURE_MAX_PER_ACCOUNT, LOGIN_FAILURE_WINDOW_MS, REGISTRATION_MAX_PER_IP } from "@/lib/security-rate-limit";

const authSource = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const registrationRoute = readFileSync(new URL("../src/app/api/auth/register/route.ts", import.meta.url), "utf8");
const limiterSource = readFileSync(new URL("../src/lib/security-rate-limit.ts", import.meta.url), "utf8");
const nginxHeaders = readFileSync(new URL("../deployment/nginx/security-proxy-headers.conf", import.meta.url), "utf8");

describe("persistent authentication rate limits", () => {
  it("accepts only the Nginx trusted client header", () => {
    const spoofed = new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2" } });
    const trusted = new Request("https://example.test", { headers: { "x-riezz-trusted-client-ip": "2001:db8::1", "x-forwarded-for": "203.0.113.1" } });
    expect(trustedClientIp(spoofed)).toBeNull();
    expect(clientRateLimitIdentity(spoofed)).toBe("untrusted-proxy");
    expect(trustedClientIp(trusted)).toBe("2001:db8::1");
  });

  it("hashes limiter identities and uses bounded persistent windows", () => {
    const identifier = "admin@example.test";
    expect(hashRateLimitKey(identifier)).not.toContain(identifier);
    expect(LOGIN_FAILURE_MAX_PER_ACCOUNT).toBe(10);
    expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(REGISTRATION_MAX_PER_IP).toBeGreaterThan(0);
    expect(limiterSource).toContain("securityRateLimit");
    expect(limiterSource).toContain("TransactionIsolationLevel.Serializable");
  });

  it("applies login and registration limits without client forwarding fallbacks", () => {
    expect(authSource).toContain("login-account");
    expect(authSource).toContain("login-ip");
    expect(authSource).not.toContain('get("x-forwarded-for")');
    expect(registrationRoute).toContain("registration-email");
    expect(registrationRoute).toContain("registration-ip");
    expect(nginxHeaders).toContain("X-Riezz-Trusted-Client-IP");
    expect(nginxHeaders).toContain('X-Forwarded-For ""');
  });
});
