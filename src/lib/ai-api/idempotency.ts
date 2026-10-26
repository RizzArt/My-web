import { createHmac } from "node:crypto";

function fingerprintSecret() {
  const value = process.env.RIEZZ99_REQUEST_FINGERPRINT_SECRET?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("RIEZZ99_REQUEST_FINGERPRINT_SECRET wajib dikonfigurasi di production.");
  return "development-only-riezz99-request-fingerprint-secret";
}

const MAX_CANONICAL_DEPTH = 128;
const MAX_CANONICAL_NODES = 100_000;

type CanonicalState = { nodes: number };

function canonical(value: unknown, depth = 0, state: CanonicalState = { nodes: 0 }): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new Error("Struktur request terlalu dalam.");
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES) throw new Error("Struktur request terlalu besar.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nilai request tidak valid.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1, state)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, depth + 1, state)}`).join(",")}}`;
  }
  throw new Error("Nilai request tidak valid.");
}

export function requestFingerprint(value: unknown) {
  return createHmac("sha256", fingerprintSecret()).update(canonical(value), "utf8").digest("hex");
}

export function validateIdempotencyKey(value: string | null | undefined) {
  if (!value || value.length < 8 || value.length > 200 || !/^[A-Za-z0-9._:+/-]+$/.test(value)) throw new Error("Idempotency-Key tidak valid.");
  return value;
}
