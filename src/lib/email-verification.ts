import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_MAX_RESENDS_PER_HOUR = 5;

export function generateVerificationCode() {
  return String(randomInt(100000, 1000000));
}

function verificationSecret() {
  return process.env.EMAIL_VERIFICATION_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "development-email-verification-secret";
}

export function hashVerificationCode(code: string) {
  return createHmac("sha256", verificationSecret()).update(code).digest("hex");
}

export function verificationCodeMatches(code: string, hash: string) {
  const expected = Buffer.from(hashVerificationCode(code), "hex");
  const received = Buffer.from(hash, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "alamat email Anda";
  return `${local[0]}${local.length > 1 ? "***" : "***"}@${domain}`;
}

export function isExpired(date: Date, now = new Date()) {
  return date.getTime() <= now.getTime();
}
