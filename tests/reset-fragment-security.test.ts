import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const emailService = readFileSync(new URL("../src/lib/email/service.ts", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("../src/app/reset-password/page.tsx", import.meta.url), "utf8");
const resetLayout = readFileSync(new URL("../src/app/reset-password/layout.tsx", import.meta.url), "utf8");
const nginxConfig = readFileSync(new URL("../deployment/nginx/security-http.conf.example", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

describe("reset token transport", () => {
  it("keeps the reset bearer token out of request URLs", () => {
    expect(emailService).toContain("/reset-password#token=");
    expect(emailService).not.toContain("/reset-password?token=");
    expect(resetPage).toContain("window.location.hash");
    expect(resetPage).toContain("window.history.replaceState");
    expect(resetPage).not.toContain("window.location.search");
    expect(resetLayout).toContain("window.__riezz99ResetToken");
    expect(resetLayout).toContain("window.history.replaceState");
  });

  it("prevents referrer and access-log query leaks", () => {
    expect(resetLayout).toContain('referrer: "no-referrer"');
    expect(nginxConfig).toContain("$request_method $uri $server_protocol");
    expect(nginxConfig).toContain("$riezz_access_log_enabled");
    expect(nginxConfig).toContain("/api/auth/reset-password 0;");
    expect(nginxConfig).toContain("/api/admin/mfa/enroll 0;");
    expect(nginxConfig).not.toContain("$request_uri");
    expect(nginxConfig).not.toContain("$http_referer");
    expect(nextConfig).toContain('{ key: "Referrer-Policy", value: "no-referrer" }');
  });
});
