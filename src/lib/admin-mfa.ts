import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_MFA_ENROLLMENT_TTL_MS = 15 * 60 * 1000;
export const ADMIN_MFA_RECOVERY_CODE_COUNT = 10;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function mfaSecret() {
  const secret = process.env.ADMIN_MFA_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_MFA_SECRET atau AUTH_SECRET wajib dikonfigurasi di production.");
  return "development-admin-mfa-secret";
}

function encodeBase32(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string) {
  const normalized = value.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("TOTP secret is invalid.");
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function normalizeRecoveryCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function hashRecoveryCode(value: string) {
  return createHmac("sha256", mfaSecret()).update(normalizeRecoveryCode(value)).digest("hex");
}

export function generateRecoveryCodes() {
  return Array.from({ length: ADMIN_MFA_RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(10).toString("hex").toUpperCase();
    return raw.match(/.{1,5}/g)?.join("-") ?? raw;
  });
}

function counterBuffer(counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

export function totpCode(secret: string, now = Date.now()) {
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, now + offset * TOTP_PERIOD_SECONDS * 1000));
    const received = Buffer.from(code);
    if (expected.length === received.length && timingSafeEqual(expected, received)) return true;
  }
  return false;
}

export function totpUri(input: { secret: string; email: string }) {
  const issuer = "Riezz99";
  const label = `${issuer}:${input.email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${input.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}
