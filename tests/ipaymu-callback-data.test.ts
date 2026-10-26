import { describe, expect, it } from "vitest";
import { parseIpaymuCallbackIdentity } from
  "../src/lib/payments/ipaymu-callback-data";

const sample = {
  trx_id: "123",
  reference_id: "order-1",
  referenceId: "order-1",
  merchant: "test-merchant",
  via: "va",
  channel: "bni",
  payment_no: "0012345",
  va: "0012345",
  is_sandbox: "false",
};

describe("iPaymu callback identity", () => {
  it("extracts invoice identity and preserves leading zeroes", () => {
    expect(parseIpaymuCallbackIdentity(
      sample, "test-merchant", "production",
    )).toMatchObject({
      transactionId: "123", referenceId: "order-1",
      bank: "bni", paymentNo: "0012345",
    });
  });

  it("accepts numeric transaction IDs", () => {
    expect(parseIpaymuCallbackIdentity(
      { ...sample, trx_id: 123 }, "test-merchant", "production",
    ).transactionId).toBe("123");
  });

  it("rejects a different merchant", () => {
    expect(() => parseIpaymuCallbackIdentity(
      sample, "different", "production",
    )).toThrow();
  });

  it("rejects a different environment", () => {
    expect(() => parseIpaymuCallbackIdentity(
      sample, "test-merchant", "sandbox",
    )).toThrow();
  });

  it("rejects conflicting reference IDs", () => {
    expect(() => parseIpaymuCallbackIdentity(
      { ...sample, referenceId: "another-order" },
      "test-merchant", "production",
    )).toThrow();
  });

  it("rejects missing references", () => {
    expect(() => parseIpaymuCallbackIdentity(
      { ...sample, reference_id: undefined, referenceId: undefined },
      "test-merchant", "production",
    )).toThrow();
  });

  it("rejects conflicting or invalid payment numbers", () => {
    for (const change of [
      { va: "99999" }, { payment_no: "12abc" }, { payment_no: 12345 },
    ]) {
      expect(() => parseIpaymuCallbackIdentity(
        { ...sample, ...change }, "test-merchant", "production",
      )).toThrow();
    }
  });

  it("rejects other payment methods", () => {
    expect(() => parseIpaymuCallbackIdentity(
      { ...sample, via: "qris" }, "test-merchant", "production",
    )).toThrow();
  });
});
