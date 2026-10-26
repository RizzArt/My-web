import { describe, expect, it } from "vitest";
import { checkoutInput } from "@/lib/payments/checkout";

const base = { items: [{ productId: "product-1", quantity: 1 }], customerName: "Customer Test", customerEmail: "delivery@example.com", customerEmailConfirmation: "delivery@example.com" };

describe("checkout recipient snapshot validation", () => {
  it("accepts and preserves the delivery email in checkout input", () => {
    expect(checkoutInput.parse(base).customerEmail).toBe("delivery@example.com");
  });

  it("rejects mismatched email confirmation", () => {
    expect(() => checkoutInput.parse({ ...base, customerEmailConfirmation: "other@example.com" })).toThrow();
  });
});
