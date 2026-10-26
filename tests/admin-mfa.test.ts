import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCode, verifyTotpCode } from "@/lib/admin-mfa";
import { adminMfaEnrollmentPayload } from "@/lib/admin-mfa-enrollment-input";

const authSource = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/admin-mfa-service.ts", import.meta.url), "utf8");
const enrollmentRoute = readFileSync(new URL("../src/app/api/admin/mfa/enroll/route.ts", import.meta.url), "utf8");
const enrollmentPanel = readFileSync(new URL("../src/components/admin-mfa-panel.tsx", import.meta.url), "utf8");

describe("admin MFA", () => {
  it("verifies TOTP without persisting a raw secret or recovery code", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totpCode(secret, now);
    const recoveryCode = generateRecoveryCodes()[0];
    expect(verifyTotpCode(secret, code, now)).toBe(true);
    expect(verifyTotpCode(secret, "000000", now)).toBe(false);
    expect(hashRecoveryCode(recoveryCode)).not.toContain(recoveryCode.replace(/-/g, ""));
  });

  it("creates separate MFA, enrollment, and hashed recovery-code records", () => {
    expect(schema).toContain("model AdminMfaCredential");
    expect(schema).toContain("model AdminMfaEnrollment");
    expect(schema).toContain("model AdminMfaRecoveryCode");
    expect(schema).toContain("codeHash");
    expect(service).toContain("usedAt: null");
    expect(service).toContain("sessionVersion: { increment: 1 }");
    expect(service).not.toContain("console.");
  });

  it("requires MFA only after enrollment and blocks OAuth bypass afterward", () => {
    expect(authSource).toContain("verifyAdminMfaLogin");
    expect(authSource).toContain('error.code = mfaCode ? "mfa-invalid" : "mfa-required"');
    expect(authSource).toContain('databaseUser.role === "ADMIN" && databaseUser.adminMfaCredential');
  });

  it("requires a password step-up and the active factor before replacing an authenticator", () => {
    expect(enrollmentRoute).toContain("bcrypt.compare(parsed.data.password, user.passwordHash)");
    expect(enrollmentRoute).toContain("verifyAdminMfaLogin(session.user.id, parsed.data.mfaCode ?? \"\")");
    expect(enrollmentPanel).toContain("Konfirmasi keamanan");
    expect(enrollmentPanel).toContain("Password lokal");
  });

  it("omits the optional MFA code during an initial enrollment", () => {
    const initial = new FormData();
    initial.set("password", "test-password");
    expect(adminMfaEnrollmentPayload(initial)).toEqual({ password: "test-password" });

    const replacement = new FormData();
    replacement.set("password", "test-password");
    replacement.set("mfaCode", "123456");
    expect(adminMfaEnrollmentPayload(replacement)).toEqual({ password: "test-password", mfaCode: "123456" });
  });
});
