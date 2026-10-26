import { describe, expect, it } from "vitest";
import {
  assertSociaBuzzAlternativeAllowed,
} from "@/lib/payments/sociabuzz-guard";

describe("SociaBuzz payment method lock", () => {
  it("blocks wallet payment and cancellation after QR processing starts", () => {
    expect(() => assertSociaBuzzAlternativeAllowed({
      provider: "SOCIABUZZ",
      externalId: `scbz:${"a".repeat(64)}`,
    })).toThrow();
  });

  it.each([
    null,
    { provider: "SOCIABUZZ", externalId: `scbz_draft:${"a".repeat(64)}` },
    { provider: "QRIS_MANUAL", externalId: null },
    { provider: "WALLET", externalId: "wallet:order-1" },
  ])("allows other methods before an active SociaBuzz invoice: %j", (payment) => {
    expect(() => assertSociaBuzzAlternativeAllowed(payment)).not.toThrow();
  });
});

describe("SociaBuzz terminal invoice lock", () => {
  it.each(["EXPIRED", "FAILED", "CANCELLED"])(
    "allows cancellation after verified terminal status %s",
    (status) => {
      expect(() => assertSociaBuzzAlternativeAllowed({
        provider: "SOCIABUZZ",
        externalId: `scbz:${"a".repeat(64)}`,
        status,
      })).not.toThrow();
    },
  );
});
