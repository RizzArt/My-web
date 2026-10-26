import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_MAX_PER_EMAIL = 3;
export const PASSWORD_RESET_MAX_PER_IP = 10;

function resetSecret() {
  return process.env.PASSWORD_RESET_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "development-password-reset-secret";
}

export function generatePasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string) {
  return createHmac("sha256", resetSecret()).update(token).digest("hex");
}

export function passwordResetTokenMatches(token: string, hash: string) {
  const expected = Buffer.from(hashPasswordResetToken(token), "hex");
  const received = Buffer.from(hash, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function hashResetRateKey(value: string) {
  return createHmac("sha256", resetSecret()).update(value).digest("hex");
}

export function passwordResetExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}

export function publicAppUrl() {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL ?? "https://riezz99.biz.id";
  try {
    const url = new URL(configured);
    const isolatedStagingUrl = process.env.STAGING_ISOLATED_ENVIRONMENT === "true"
      && process.env.STAGING_DIAGNOSTIC_HOSTNAME === url.hostname
      && url.hostname === "security-staging.riezz99.biz.id";
    if (url.protocol !== "https:" || (url.hostname !== "riezz99.biz.id" && !isolatedStagingUrl)) return "https://riezz99.biz.id";
    return url.origin;
  } catch {
    return "https://riezz99.biz.id";
  }
}
