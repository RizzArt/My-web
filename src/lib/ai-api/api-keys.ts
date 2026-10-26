import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "rz_live_";
const KEY_PATTERN = /^rz_live_[A-Za-z0-9_-]{43}$/;

function keyPepper() {
  const value = process.env.RIEZZ99_API_KEY_PEPPER?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("RIEZZ99_API_KEY_PEPPER wajib dikonfigurasi di production.");
  return "development-only-riezz99-api-key-pepper";
}

export function hashApiKey(plaintext: string) {
  if (!KEY_PATTERN.test(plaintext)) throw new Error("Format API key tidak valid.");
  return createHmac("sha256", keyPepper()).update(plaintext, "utf8").digest("hex");
}

export function verifyApiKey(plaintext: string, expectedHash: string) {
  if (!KEY_PATTERN.test(plaintext) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashApiKey(plaintext), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createApiKey(random = (size: number) => randomBytes(size)) {
  const plaintext = `${KEY_PREFIX}${random(32).toString("base64url")}`;
  if (!KEY_PATTERN.test(plaintext)) throw new Error("Gagal membuat API key.");
  return { plaintext, prefix: plaintext.slice(0, 16), secretHash: hashApiKey(plaintext) };
}

export function parseApiKey(authorization: string | null | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const value = authorization.slice(7);
  return KEY_PATTERN.test(value) ? value : null;
}

export { KEY_PATTERN, KEY_PREFIX };
