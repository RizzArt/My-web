import { createHmac, timingSafeEqual } from "node:crypto";

type Payload = Record<string, unknown>;
const integers = new Set([
  "trx_id", "status_code", "transaction_status_code", "paid_off",
]);
const forbidden = new Set(["__proto__", "constructor", "prototype"]);

function fail(): never {
  throw new Error("Format callback iPaymu tidak valid.");
}

export function parseIpaymuCallbackBody(
  body: string,
  contentType: string,
): Payload {
  if (Buffer.byteLength(body, "utf8") > 65536) fail();
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "application/json") {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { fail(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();
    return parsed as Payload;
  }
  if (type === "application/x-www-form-urlencoded") {
    const result: Payload = Object.create(null);
    for (const [key, value] of new URLSearchParams(body)) {
      if (forbidden.has(key) || Object.hasOwn(result, key)) fail();
      result[key] = value;
    }
    return result;
  }
  fail();
}

export function canonicalIpaymuCallback(payload: Payload): string {
  const normalized: Payload = Object.create(null);

  for (const [key, value] of Object.entries(payload)) {
    if (forbidden.has(key)) fail();
    if (key === "signature") continue;

    if (key === "additional_info") {
      if (value === "[]") normalized[key] = [];
      else if (Array.isArray(value)) normalized[key] = value;
      else fail();
      continue;
    }

    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) fail();

    if (integers.has(key)) {
      const text = String(value);
      if (!/^-?[0-9]+$/.test(text)) fail();
      const number = Number(text);
      if (!Number.isSafeInteger(number)) fail();
      normalized[key] = number;
    } else if (key === "is_escrow") {
      if (![true, false, 1, 0, "true", "false", "1", "0"].includes(
        value as string | number | boolean,
      )) fail();
      normalized[key] = value === true || value === 1 ||
        value === "true" || value === "1";
    } else {
      normalized[key] = String(value);
    }
  }

  if (!Object.hasOwn(normalized, "additional_info")) {
    normalized.additional_info = [];
  }

  const ordered: Payload = Object.create(null);
  for (const key of Object.keys(normalized).sort(
    (left, right) => left.localeCompare(right, "en"),
  )) ordered[key] = normalized[key];

  return JSON.stringify(ordered).replace(/\//g, "\\/");
}

export function verifyIpaymuCallbackSignature(
  payload: Payload,
  signature: string | null,
  merchantVa: string,
): boolean {
  if (!merchantVa || !signature || !/^[a-fA-F0-9]{64}$/.test(signature)) {
    return false;
  }
  try {
    const calculated = createHmac("sha256", merchantVa)
      .update(canonicalIpaymuCallback(payload), "utf8")
      .digest();
    return timingSafeEqual(calculated, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
