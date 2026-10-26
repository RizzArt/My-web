import { describe, expect, it } from "vitest";
import { parseVaEvidence } from "../src/lib/payments/ipaymu-validation";

const expected = {
  transactionId: "12345", referenceId: "order-1", amount: 10000, fee: 3500,
};
const evidence = {
  TransactionId: 12345, ReferenceId: "order-1", Amount: 13500, Fee: 3500, Status: 1,
};

describe("iPaymu authoritative payment evidence", () => {
  it.each([1, 6])("accepts confirmed payment status %s", (Status) => {
    expect(parseVaEvidence({ ...evidence, Status }, expected).paid).toBe(true);
  });
  it.each([0, 2, 4, 5, -2])("does not mark status %s as paid", (Status) => {
    expect(parseVaEvidence({ ...evidence, Status }, expected).paid).toBe(false);
  });
  it.each([
    { ReferenceId: "other-order" },
    { TransactionId: 99999 },
    { Amount: 1 },
    { Fee: 0 },
    { Status: 7 },
    { Status: 3 },
  ])("rejects mismatching or review-required evidence: %j", (change) => {
    expect(() => parseVaEvidence({ ...evidence, ...change }, expected)).toThrow();
  });
});
