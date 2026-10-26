import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { publicAppUrl } from "@/lib/password-reset";
import { stagingSecurityDiagnosticSnapshot } from "@/lib/staging-security-diagnostics";

const diagnosticsSource = readFileSync(new URL("../src/lib/staging-security-diagnostics.ts", import.meta.url), "utf8");
const rateProbeSource = readFileSync(new URL("../src/app/api/%255Fstaging/security/rate-limit-probe/route.ts", import.meta.url), "utf8");
const proxyProbeSource = readFileSync(new URL("../src/app/api/%255Fstaging/security/proxy-probe/route.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/%255Fstaging/security/page.tsx", import.meta.url), "utf8");
const diagnosticsComponentSource = readFileSync(new URL("../src/components/staging-security-diagnostics.tsx", import.meta.url), "utf8");
const resetSource = readFileSync(new URL("../src/lib/password-reset.ts", import.meta.url), "utf8");
const savedResetEnvironment = {
  APP_URL: process.env.APP_URL,
  AUTH_URL: process.env.AUTH_URL,
  STAGING_ISOLATED_ENVIRONMENT: process.env.STAGING_ISOLATED_ENVIRONMENT,
  STAGING_DIAGNOSTIC_HOSTNAME: process.env.STAGING_DIAGNOSTIC_HOSTNAME,
  STAGING_DIAGNOSTIC_SECRET: process.env.STAGING_DIAGNOSTIC_SECRET,
};

function restoreEnvironment(name: keyof typeof savedResetEnvironment) {
  const value = savedResetEnvironment[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnvironment("APP_URL");
  restoreEnvironment("AUTH_URL");
  restoreEnvironment("STAGING_ISOLATED_ENVIRONMENT");
  restoreEnvironment("STAGING_DIAGNOSTIC_HOSTNAME");
  restoreEnvironment("STAGING_DIAGNOSTIC_SECRET");
});

describe("staging security diagnostics", () => {
  it("is explicitly host-gated and fingerprints rather than returning a client IP", () => {
    expect(diagnosticsSource).toContain('STAGING_SECURITY_DIAGNOSTICS_ENABLED === "true"');
    expect(diagnosticsSource).toContain('STAGING_ISOLATED_ENVIRONMENT === "true"');
    expect(diagnosticsSource).toContain("STAGING_DIAGNOSTIC_HOSTNAME");
    expect(diagnosticsSource).toContain("createHmac");
    expect(diagnosticsSource).not.toContain("clientIp,");
    expect(pageSource).toContain("notFound()");
  });

  it("uses the trusted Nginx identity for a separate persistent probe bucket", () => {
    expect(rateProbeSource).toContain("trustedClientIp(request)");
    expect(rateProbeSource).toContain('scope: "staging-security-probe-ip"');
    expect(rateProbeSource).toContain("limit: PROBE_LIMIT");
    expect(rateProbeSource).not.toContain("x-forwarded-for");
    expect(proxyProbeSource).toContain('request.headers.get("host")');
    expect(rateProbeSource).toContain('request.headers.get("host")');
    expect(proxyProbeSource).not.toContain("new URL(request.url).hostname");
    expect(rateProbeSource).not.toContain("new URL(request.url).hostname");
    expect(diagnosticsComponentSource).not.toContain('"CF-Connecting-IP"');
  });

  it("treats a Next.js loopback replacement as cleared forwarded input", () => {
    process.env.STAGING_DIAGNOSTIC_SECRET = "test-only-staging-diagnostic-secret";
    const snapshot = stagingSecurityDiagnosticSnapshot(new Request("http://127.0.0.1/api/_staging/security/proxy-probe", {
      headers: {
        "X-Riezz-Trusted-Client-IP": "203.0.113.77",
        "X-Forwarded-For": "::ffff:127.0.0.1",
        "X-Real-IP": "127.0.0.1",
      },
    }));
    expect(snapshot.trustedIdentityAccepted).toBe(true);
    expect(snapshot.forwardedForCleared).toBe(true);
    expect(snapshot.realIpRewrittenToLoopback).toBe(true);
  });

  it("keeps staging reset links on the explicitly permitted staging hostname", () => {
    expect(resetSource).toContain('process.env.STAGING_ISOLATED_ENVIRONMENT === "true"');
    expect(resetSource).toContain('url.hostname === "security-staging.riezz99.biz.id"');
    process.env.APP_URL = "https://security-staging.riezz99.biz.id";
    process.env.STAGING_ISOLATED_ENVIRONMENT = "true";
    process.env.STAGING_DIAGNOSTIC_HOSTNAME = "security-staging.riezz99.biz.id";
    expect(publicAppUrl()).toBe("https://security-staging.riezz99.biz.id");
    process.env.STAGING_ISOLATED_ENVIRONMENT = "false";
    expect(publicAppUrl()).toBe("https://riezz99.biz.id");
  });
});
