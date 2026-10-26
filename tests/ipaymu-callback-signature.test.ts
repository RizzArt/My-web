import { describe, expect, it } from "vitest";
import {
  canonicalIpaymuCallback,
  parseIpaymuCallbackBody,
  verifyIpaymuCallbackSignature,
} from "../src/lib/payments/ipaymu-callback-signature";

const payload = {
  trx_id: "123",
  status_code: "1",
  fee: "3500",
  url: "https://example.com/cb",
  is_escrow: "0",
  payment_no: "00123",
};
const vector =
  "97c9079eb498b01794d49d2c6512177fe992ccae4da7d547c3323d02102728b5";

describe("iPaymu callback signature", () => {
  it("matches an independently calculated HMAC vector", () => {
    expect(verifyIpaymuCallbackSignature(
      payload, vector, "test-merchant",
    )).toBe(true);
  });

  it("normalizes form and JSON values identically", () => {
    const form = parseIpaymuCallbackBody(
      new URLSearchParams(payload).toString(),
      "application/x-www-form-urlencoded; charset=UTF-8",
    );
    const json = parseIpaymuCallbackBody(JSON.stringify({
      ...payload, trx_id: 123, status_code: 1,
      is_escrow: false, additional_info: [],
    }), "application/json");
    expect(canonicalIpaymuCallback(form)).toBe(canonicalIpaymuCallback(json));
  });

  it("preserves leading zeroes in the payment number", () => {
    expect(canonicalIpaymuCallback(payload)).toContain('"payment_no":"00123"');
  });

  it("accepts an empty additional_info form field", () => {
    expect(canonicalIpaymuCallback({
      ...payload, additional_info: "[]",
    })).toBe(canonicalIpaymuCallback(payload));
  });

  it("ignores a body signature and requires the header signature", () => {
    expect(verifyIpaymuCallbackSignature({
      ...payload, signature: "ignored",
    }, vector, "test-merchant")).toBe(true);
    expect(verifyIpaymuCallbackSignature(
      { ...payload, signature: vector }, null, "test-merchant",
    )).toBe(false);
  });

  it("rejects a modified amount or wrong merchant key", () => {
    expect(verifyIpaymuCallbackSignature(
      { ...payload, fee: "0" }, vector, "test-merchant",
    )).toBe(false);
    expect(verifyIpaymuCallbackSignature(
      payload, vector, "wrong-key",
    )).toBe(false);
  });

  it("rejects malformed signature headers", () => {
    for (const signature of [null, "", "abc", "z".repeat(64)]) {
      expect(verifyIpaymuCallbackSignature(
        payload, signature, "test-merchant",
      )).toBe(false);
    }
  });

  it("rejects duplicate form fields", () => {
    expect(() => parseIpaymuCallbackBody(
      "trx_id=123&trx_id=456", "application/x-www-form-urlencoded",
    )).toThrow();
  });

  it("rejects unsupported bodies", () => {
    for (const body of ["[]", "null", "{"]) {
      expect(() => parseIpaymuCallbackBody(body, "application/json")).toThrow();
    }
    expect(() => parseIpaymuCallbackBody("abc", "text/plain")).toThrow();
    expect(() => parseIpaymuCallbackBody(
      "x".repeat(65537), "application/json",
    )).toThrow();
  });

  it("rejects invalid integer and boolean values", () => {
    for (const trx_id of ["123abc", "1.5", "9007199254740992"]) {
      expect(() => canonicalIpaymuCallback({ ...payload, trx_id })).toThrow();
    }
    expect(() => canonicalIpaymuCallback({
      ...payload, is_escrow: "unknown",
    })).toThrow();
  });

  it("rejects unexpected objects and prototype keys", () => {
    expect(() => canonicalIpaymuCallback({
      ...payload, fee: { amount: 3500 },
    })).toThrow();
    expect(() => canonicalIpaymuCallback(
      JSON.parse('{"__proto__":"unsafe"}'),
    )).toThrow();
  });
});
