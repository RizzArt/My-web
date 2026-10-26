import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_VERIFICATION_MAX_ATTEMPTS, EMAIL_VERIFICATION_RESEND_COOLDOWN_MS, EMAIL_VERIFICATION_TTL_MS, generateVerificationCode, hashVerificationCode, isExpired, maskEmail, verificationCodeMatches } from "@/lib/email-verification";

const registerRoute = readFileSync(new URL("../src/app/api/auth/register/route.ts", import.meta.url), "utf8");
const verifyRoute = readFileSync(new URL("../src/app/api/auth/verify-email/route.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");

describe("email verification security", () => {
  it("generates a six digit numeric OTP", () => expect(generateVerificationCode()).toMatch(/^\d{6}$/));
  it("hashes OTP instead of storing plaintext", () => {
    const code = "123456";
    expect(hashVerificationCode(code)).not.toBe(code);
    expect(registerRoute).toContain("codeHash: hashVerificationCode(code)");
  });
  it("matches the correct code and rejects a wrong code", () => {
    const hash = hashVerificationCode("123456");
    expect(verificationCodeMatches("123456", hash)).toBe(true);
    expect(verificationCodeMatches("654321", hash)).toBe(false);
  });
  it("uses a ten minute expiry", () => expect(EMAIL_VERIFICATION_TTL_MS).toBe(600000));
  it("rejects expired timestamps", () => expect(isExpired(new Date(Date.now() - 1))).toBe(true));
  it("accepts a future timestamp", () => expect(isExpired(new Date(Date.now() + 1000))).toBe(false));
  it("limits attempts to five", () => {
    expect(EMAIL_VERIFICATION_MAX_ATTEMPTS).toBe(5);
    expect(verifyRoute).toContain("record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS");
  });
  it("invalidates the code after a successful verification", () => expect(verifyRoute).toContain("emailVerificationCode.deleteMany"));
  it("invalidates the previous code on resend", () => expect(verifyRoute).toContain("emailVerificationCode.upsert"));
  it("enforces the sixty second resend cooldown", () => expect(EMAIL_VERIFICATION_RESEND_COOLDOWN_MS).toBe(60000));
  it("does not return the OTP from the verification API", () => {
    expect(verifyRoute).not.toContain("code: code");
    expect(verifyRoute).not.toContain("otp: code");
  });
  it("requires a six digit code server-side", () => expect(verifyRoute).toContain("/^\\d{6}$/"));
  it("prevents unverified credentials login", () => expect(auth).toContain("if (!user.emailVerified)"));
  it("does not login from the register page", () => {
    const page = readFileSync(new URL("../src/app/register/page.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("signIn(");
    expect(page).toContain("/verify-email");
  });
  it("masks the email shown to the user", () => expect(maskEmail("alice@gmail.com")).toBe("a***@gmail.com"));
});
