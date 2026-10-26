import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function key() {
  const configured = process.env.DELIVERY_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  if (process.env.NODE_ENV === "production") throw new Error("DELIVERY_ENCRYPTION_KEY is required in production");
  return crypto.createHash("sha256").update("development-only-delivery-key").digest();
}

function adminMfaKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY ?? process.env.DELIVERY_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  if (process.env.NODE_ENV === "production") throw new Error("MFA_ENCRYPTION_KEY is required in production");
  return crypto.createHash("sha256").update("development-only-mfa-key").digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) return value; // Supports inventory seeded before encryption was added.
  try {
    const decipher = crypto.createDecipheriv(algorithm, key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return value;
  }
}

export function encryptAdminMfaSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, adminMfaKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptAdminMfaSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Admin MFA secret is invalid.");
  const decipher = crypto.createDecipheriv(algorithm, adminMfaKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function newDownloadToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashDownloadToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashSecret(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function maskPayoutDestination(value: string) {
  const clean = value.trim();
  return clean.length <= 4 ? "****" : `****${clean.slice(-4)}`;
}
