import { describe, expect, it } from "vitest";
import { parseVaInvoice } from "../src/lib/payments/ipaymu-validation";

const expected = { referenceId: "order-1", bank: "bni", amount: 10000, fee: 3500 };
const response = {
  TransactionId: 12345, ReferenceId: "order-1", Via: "va", Channel: "bni",
  PaymentNo: "001234567890", PaymentName: "BNI Virtual Account",
  Total: 13500, Fee: 3500, Expired: "2026-10-01 21:00:00",
};

describe("iPaymu invoice validation", () => {
  it("preserves leading zeroes and buyer fee", () => {
    const invoice = parseVaInvoice(response, expected);
    expect(invoice.paymentNo).toBe("001234567890");
    expect(invoice.amount).toBe(10000);
    expect(invoice.total).toBe(13500);
  });
  it.each([
    { ReferenceId: "another-order" },
    { Channel: "bca" },
    { Fee: 4500 },
    { Total: 10000 },
    { Via: "qris" },
    { PaymentNo: 12345 },
  ])("rejects a mismatching invoice: %j", (change) => {
    expect(() => parseVaInvoice({ ...response, ...change }, expected)).toThrow();
  });
});
