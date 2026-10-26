import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePasswordResetToken, hashPasswordResetToken, PASSWORD_RESET_MAX_ATTEMPTS, PASSWORD_RESET_TTL_MS, passwordResetExpired, passwordResetTokenMatches } from "@/lib/password-reset";

const forgotRoute = readFileSync(new URL("../src/app/api/auth/forgot-password/route.ts", import.meta.url), "utf8");
const resetRoute = readFileSync(new URL("../src/app/api/auth/reset-password/route.ts", import.meta.url), "utf8");
const emailService = readFileSync(new URL("../src/lib/email/service.ts", import.meta.url), "utf8");

describe("password reset security", () => {
  it("uses a random token and stores only its hash", () => {
    const token = generatePasswordResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashPasswordResetToken(token)).not.toContain(token);
    expect(forgotRoute).toContain("tokenHash");
    expect(forgotRoute).not.toContain("console.log(token");
  });

  it("uses a thirty-minute expiry", () => expect(PASSWORD_RESET_TTL_MS).toBe(30 * 60 * 1000));

  it("does not issue a password reset token for Google-only users", () => {
    expect(forgotRoute).toContain("if (!user.passwordHash)");
    expect(forgotRoute).toContain("sendGoogleSignInHelpEmail");
  });

  it("rejects expired tokens and matches only the original token", () => {
    const token = generatePasswordResetToken();
    const hash = hashPasswordResetToken(token);
    expect(passwordResetExpired(new Date(Date.now() - 1))).toBe(true);
    expect(passwordResetExpired(new Date(Date.now() + 1000))).toBe(false);
    expect(passwordResetTokenMatches(token, hash)).toBe(true);
    expect(passwordResetTokenMatches(generatePasswordResetToken(), hash)).toBe(false);
  });

  it("claims a token atomically so reuse and concurrent requests fail", () => {
    expect(PASSWORD_RESET_MAX_ATTEMPTS).toBe(5);
    expect(resetRoute).toContain("usedAt: null");
    expect(resetRoute).toContain("updateMany");
    expect(resetRoute).toContain("usedAt: now");
    expect(resetRoute).toContain("sessionVersion: { increment: 1 }");
  });

  it("rate-limits requests in a serializable transaction", () => {
    expect(forgotRoute).toContain('isolationLevel: Prisma.TransactionIsolationLevel.Serializable');
    expect(forgotRoute).toContain("PASSWORD_RESET_MAX_PER_EMAIL");
    expect(forgotRoute).toContain("PASSWORD_RESET_MAX_PER_IP");
    expect(forgotRoute).toContain("P2034");
  });

  it("uses one generic response for unknown emails and delivery failures", () => {
    expect(forgotRoute).toContain("const GENERIC_RESPONSE");
    expect(forgotRoute).toContain("return NextResponse.json({ ok: true, message: GENERIC_RESPONSE })");
    expect(forgotRoute).toContain("sendPasswordResetEmail");
    expect(forgotRoute).toContain("passwordResetToken.deleteMany");
    expect(emailService).not.toContain("console.info(message");
  });
});
