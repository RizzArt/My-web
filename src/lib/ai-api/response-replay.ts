import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const REPLAY_TTL_MS = 24 * 60 * 60_000;
const MAX_REPLAY_PLAINTEXT_BYTES = 3 * 1024 * 1024;
const REPLAY_VERSION = "v1";
const REPLAY_AAD_PREFIX = "riezz99-ai-api-response-replay:v1";

export type AiApiResponseReplayBinding = {
  requestId: string;
  apiKeyId: string;
  walletId: string;
  endpoint: string;
  requestFingerprint: string;
};

function replayKey() {
  const secret = process.env.RIEZZ99_REQUEST_FINGERPRINT_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") throw new Error("RIEZZ99_REQUEST_FINGERPRINT_SECRET wajib dikonfigurasi di production.");
  return createHmac("sha256", secret || "development-only-riezz99-request-fingerprint-secret")
    .update("response-replay-key:v1", "utf8")
    .digest();
}

function unavailable(): never {
  throw new Error("Replay respons tidak tersedia.");
}

function replayAad(binding: AiApiResponseReplayBinding, expiresAt: Date) {
  const values = [binding.requestId, binding.apiKeyId, binding.walletId, binding.endpoint, binding.requestFingerprint];
  if (values.some((value) => typeof value !== "string" || value.length < 1 || value.length > 300)) unavailable();
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) unavailable();
  return Buffer.from(JSON.stringify([REPLAY_AAD_PREFIX, ...values, expiresAt.toISOString()]), "utf8");
}

function decodeBase64UrlStrict(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) unavailable();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) unavailable();
  return decoded;
}

export function encryptAiApiResponseReplay(value: unknown, binding: AiApiResponseReplayBinding, now = new Date()) {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_REPLAY_PLAINTEXT_BYTES) unavailable();
  const expiresAt = new Date(now.getTime() + REPLAY_TTL_MS);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", replayKey(), iv);
  cipher.setAAD(replayAad(binding, expiresAt));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [REPLAY_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join("."),
    expiresAt,
  };
}

export function authenticateAiApiResponseReplay(ciphertext: string, expiresAt: Date, binding: AiApiResponseReplayBinding) {
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) unavailable();
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== REPLAY_VERSION) unavailable();
  try {
    const iv = decodeBase64UrlStrict(parts[1]);
    const tag = decodeBase64UrlStrict(parts[2]);
    const encrypted = decodeBase64UrlStrict(parts[3]);
    if (iv.byteLength !== 12 || tag.byteLength !== 16 || encrypted.byteLength === 0 || encrypted.byteLength > MAX_REPLAY_PLAINTEXT_BYTES + 32) unavailable();
    const decipher = createDecipheriv("aes-256-gcm", replayKey(), iv);
    decipher.setAAD(replayAad(binding, expiresAt));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_REPLAY_PLAINTEXT_BYTES) unavailable();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
  } catch {
    unavailable();
  }
}

export function decryptAiApiResponseReplay(ciphertext: string, expiresAt: Date, binding: AiApiResponseReplayBinding, now = new Date()) {
  const value = authenticateAiApiResponseReplay(ciphertext, expiresAt, binding);
  if (expiresAt <= now) unavailable();
  return value;
}
