import { describe, expect, it } from "vitest";
import {
  assertIpaymuAlternativeAllowed,
  hasIpaymuWalletLock,
} from "../src/lib/payments/ipaymu-guard";

describe("iPaymu wallet protection", () => {
  it("allows wallet before an invoice request exists", () => {
    expect(() => assertIpaymuAlternativeAllowed({
      provider: "IPAYMU", externalId: "ipaymu_draft:bni:order-1",
    })).not.toThrow();
  });

  it.each([
    "ipaymu_creating:bni:order-1",
    "ipaymu:12345",
    null,
    "",
    "ipaymu_draft:broken",
  ])("locks wallet for uncertain or active identity %s", (externalId) => {
    const payment = { provider: "IPAYMU", externalId };
    expect(hasIpaymuWalletLock(payment)).toBe(true);
    expect(() => assertIpaymuAlternativeAllowed(payment)).toThrow();
  });

  it("leaves other providers to their existing guards", () => {
    expect(hasIpaymuWalletLock({
      provider: "SOCIABUZZ", externalId: "123",
    })).toBe(false);
    expect(hasIpaymuWalletLock(null)).toBe(false);
  });
});
