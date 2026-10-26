import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Temporary, side-effect-free helpers for inspecting SociaBuzz test webhooks.
 * Delete this file together with the diagnostic route once the payload shape is known.
 */
export const SOCIABUZZ_DIAGNOSTIC_MAX_BODY_BYTES = 64 * 1024;
export const SOCIABUZZ_DIAGNOSTIC_RATE_LIMIT = 10;
export const SOCIABUZZ_DIAGNOSTIC_RATE_WINDOW_MS = 60_000;

const SENSITIVE_FIELD = /(?:authorization|cookie|token|signature|secret|api[-_]?key|(?:^|[-_])key$|password|credential|private[-_]?key|access[-_]?key|email|phone|mobile|address|(?:^|[-_])(?:supporter|buyer|customer|donor|payer|recipient|user)(?:[-_](?:id|name|email|phone))?$|customer[-_]?name|full[-_]?name)/i;
const SENSITIVE_VALUE = /^(?:bearer|basic)\s/i;
const SAFE_VALUE_FIELD = /(?:^|[-_])(?:event|type|status|amount(?:[-_]?settled)?|total|currency(?:[-_]?settled)?|media[-_]?type|level|vote|invoice(?:[-_]?id)?|order(?:[-_]?(?:id|number))?|reference(?:[-_]?id)?|transaction(?:[-_]?id)?|payment(?:[-_]?(?:id|method|status))?|method|channel|created(?:[-_]?at)?|updated(?:[-_]?at)?|timestamp|time|id)$/i;
const MESSAGE_OR_CONTENT_FIELD = /^(?:message|content)$/i;
const ITEM_IDENTIFIER_FIELD = /^(?:id|sku|slug|name|title|product[-_]?id|item[-_]?id|product[-_]?name|item[-_]?name|product[-_]?title|item[-_]?title|reference(?:[-_]?id)?|product[-_]?reference(?:[-_]?id)?|item[-_]?reference(?:[-_]?id)?)$/i;
const MAX_LOG_STRING_LENGTH = 160;
const MAX_LOG_DEPTH = 6;
const MAX_LOG_ENTRIES = 50;
const MAX_LOG_ARRAY_ITEMS = 10;
const tokenComparisonKey = randomBytes(32);

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()) {
    const current = this.hits.get(key);
    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function hasOversizedDeclaredBody(contentLength: string | null) {
  if (contentLength === null) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  return Number(contentLength) > SOCIABUZZ_DIAGNOSTIC_MAX_BODY_BYTES;
}

export async function readBodyWithLimit(request: Request) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SOCIABUZZ_DIAGNOSTIC_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

type LoggedValue =
  | { type: "null" }
  | { type: "boolean" | "number"; value: boolean | number }
  | { type: "string"; value: string; length: number }
  | { type: "redacted" }
  | { type: "array"; items: LoggedValue[]; totalItems: number }
  | { type: "object"; fields: Record<string, LoggedValue>; totalFields: number }
  | { type: "max-depth" }
  | MessageOrContentSummary;

type MessageOrContentSummary = {
  type: "null" | "boolean" | "number" | "string" | "array" | "object" | "other";
  length: number;
  state: "empty" | "non-empty";
};

function isSensitiveValue(value: string) {
  return SENSITIVE_VALUE.test(value) || /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(value);
}

function summarizeMessageOrContent(value: unknown): MessageOrContentSummary {
  if (value === null) return { type: "null", length: 0, state: "empty" };
  if (typeof value === "string") return { type: "string", length: value.length, state: value.length === 0 ? "empty" : "non-empty" };
  if (Array.isArray(value)) return { type: "array", length: value.length, state: value.length === 0 ? "empty" : "non-empty" };
  if (typeof value === "object") {
    const length = Object.keys(value as Record<string, unknown>).length;
    return { type: "object", length, state: length === 0 ? "empty" : "non-empty" };
  }
  if (typeof value === "boolean") return { type: "boolean", length: String(value).length, state: "non-empty" };
  if (typeof value === "number") return { type: "number", length: String(value).length, state: "non-empty" };
  return { type: "other", length: 0, state: "empty" };
}

function summarizeItem(value: unknown, fieldName: string, depth: number): LoggedValue {
  if (SENSITIVE_FIELD.test(fieldName)) return { type: "redacted" };
  if (MESSAGE_OR_CONTENT_FIELD.test(fieldName)) return summarizeMessageOrContent(value);
  if (value === null) return { type: "null" };
  if (depth >= MAX_LOG_DEPTH) return { type: "max-depth" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.slice(0, MAX_LOG_ARRAY_ITEMS).map((entry) => summarizeItem(entry, "item", depth + 1)),
      totalItems: value.length,
    };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      fields: Object.fromEntries(entries.slice(0, MAX_LOG_ENTRIES).map(([key, entry]) => [key, summarizeItem(entry, key, depth + 1)])),
      totalFields: entries.length,
    };
  }
  if (!ITEM_IDENTIFIER_FIELD.test(fieldName) && fieldName !== "item") return { type: "redacted" };
  if (typeof value === "string") {
    if (isSensitiveValue(value)) return { type: "redacted" };
    return { type: "string", value: value.slice(0, MAX_LOG_STRING_LENGTH), length: value.length };
  }
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "number") return { type: "number", value };
  return { type: "redacted" };
}

function summarizeValue(value: unknown, fieldName: string, depth = 0): LoggedValue {
  if (SENSITIVE_FIELD.test(fieldName)) return { type: "redacted" };
  if (MESSAGE_OR_CONTENT_FIELD.test(fieldName)) return summarizeMessageOrContent(value);
  if (fieldName === "item") return summarizeItem(value, fieldName, depth);
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return SAFE_VALUE_FIELD.test(fieldName) ? { type: "boolean", value } : { type: "redacted" };
  if (typeof value === "number") return SAFE_VALUE_FIELD.test(fieldName) ? { type: "number", value } : { type: "redacted" };
  if (typeof value === "string") {
    if (isSensitiveValue(value) || !SAFE_VALUE_FIELD.test(fieldName)) return { type: "redacted" };
    return {
      type: "string",
      value: value.slice(0, MAX_LOG_STRING_LENGTH),
      length: value.length,
    };
  }
  if (depth >= MAX_LOG_DEPTH) return { type: "max-depth" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.slice(0, MAX_LOG_ARRAY_ITEMS).map((item) => summarizeValue(item, fieldName, depth + 1)),
      totalItems: value.length,
    };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      fields: Object.fromEntries(entries.slice(0, MAX_LOG_ENTRIES).map(([key, item]) => [key, summarizeValue(item, key, depth + 1)])),
      totalFields: entries.length,
    };
  }
  return { type: "redacted" };
}

export function summarizeSociaBuzzDiagnosticPayload(body: string, contentType: string | null) {
  const isJson = contentType?.toLowerCase().includes("application/json") || /^[\s]*[\[{]/.test(body);
  if (isJson) {
    try {
      return { format: "json", body: summarizeValue(JSON.parse(body), "payload") };
    } catch {
      // Never log an unparseable raw body; its contents can still contain secrets.
      return { format: "invalid-json", body: { type: "string", length: body.length } };
    }
  }

  if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    const grouped = new Map<string, string[]>();
    for (const [key, value] of new URLSearchParams(body)) {
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
    const payload = Object.fromEntries(
      [...grouped].map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
    );
    return { format: "form", body: summarizeValue(payload, "payload") };
  }

  return { format: "unparsed", body: { type: "string", length: body.length } };
}

function safeTopLevelKey(key: string) {
  if (SENSITIVE_FIELD.test(key)) return "[redacted]";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)) return "[invalid]";
  return key;
}

/** Returns field names only; values are never parsed into the diagnostic log. */
export function summarizeSociaBuzzDiagnosticTopLevelKeys(body: string, contentType: string | null) {
  const isJson = contentType?.toLowerCase().includes("application/json") || /^[\s]*[\[{]/.test(body);
  if (isJson) {
    try {
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      return Object.keys(payload as Record<string, unknown>).slice(0, MAX_LOG_ENTRIES).map(safeTopLevelKey);
    } catch {
      return [];
    }
  }

  if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return [...new Set([...new URLSearchParams(body).keys()])].slice(0, MAX_LOG_ENTRIES).map(safeTopLevelKey);
  }

  return [];
}

/** Logs the media type only, never untrusted content-type parameters. */
export function safeSociaBuzzDiagnosticContentType(contentType: string | null) {
  if (!contentType) return null;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType : "invalid";
}

export type SociaBuzzDiagnosticTokenVerification = {
  tokenPresent: boolean;
  tokenMatch: boolean | "not_configured";
};

function readDiagnosticToken(body: string, contentType: string | null) {
  const isJson = contentType?.toLowerCase().includes("application/json") || /^[\s]*[\[{]/.test(body);
  if (isJson) {
    try {
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { present: false, value: null };
      const value = (payload as Record<string, unknown>).token;
      return { present: Object.hasOwn(payload, "token"), value: typeof value === "string" ? value : null };
    } catch {
      return { present: false, value: null };
    }
  }

  if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    const token = new URLSearchParams(body).get("token");
    return { present: token !== null, value: token };
  }

  return { present: false, value: null };
}

function constantTimeTokenMatch(actual: string, expected: string) {
  // Fixed-length HMAC values let timingSafeEqual run even when token lengths differ.
  const actualDigest = createHmac("sha256", tokenComparisonKey).update(actual).digest();
  const expectedDigest = createHmac("sha256", tokenComparisonKey).update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function verifySociaBuzzDiagnosticToken(
  body: string,
  contentType: string | null,
): SociaBuzzDiagnosticTokenVerification {
  const configuredToken = process.env.SOCIABUZZ_WEBHOOK_TOKEN;
  const token = readDiagnosticToken(body, contentType);
  if (!configuredToken) return { tokenPresent: token.present, tokenMatch: "not_configured" };
  return {
    tokenPresent: token.present,
    tokenMatch: token.value !== null && constantTimeTokenMatch(token.value, configuredToken),
  };
}

export function diagnosticClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || "unknown").slice(0, 128);
}
