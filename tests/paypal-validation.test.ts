import { afterEach, describe, expect, it } from "vitest";
import { assertPayPalSandboxStorage, hasActivePayPalCheckout, paypalConfig, paypalIsAvailable, usdAmountForIdr } from "@/lib/payments/paypal";
import { paypalCaptureNeedsReview, validatePayPalCapture } from "@/lib/payments/paypal-validation";

const expected = { paypalOrderId: "PP-1", orderId: "order-1", orderNumber: "KS-1", amount: "2.50", merchantId: "MERCHANT-1" };
function capture(change: Record<string, unknown> = {}) {
  return { id: "PP-1", status: "COMPLETED", purchase_units: [{ reference_id: "KS-1", custom_id: "order-1", amount: { currency_code: "USD", value: "2.50" }, payee: { merchant_id: "MERCHANT-1" }, payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "2.50" } }] } }], ...change };
}

afterEach(() => { delete process.env.PAYPAL_ENABLED; delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.PAYPAL_MERCHANT_ID; delete process.env.PAYPAL_WEBHOOK_ID; delete process.env.PAYPAL_ELIGIBLE_SELLER_ID; delete process.env.PAYPAL_IDR_PER_USD; delete process.env.PAYPAL_MODE; delete process.env.PAYPAL_SANDBOX_STORAGE_ROOT; delete process.env.DIGITAL_STORAGE_ROOT; });

describe("PayPal payment evidence", () => {
  it("calculates USD from an explicit server rate, rounded to cents", () => {
    expect(usdAmountForIdr(40000, "16000")).toBe("2.50");
    expect(usdAmountForIdr(1, "16000")).toBe("0.01");
  });

  it("does not expose PayPal when the full Sandbox configuration is absent", () => {
    process.env.PAYPAL_ENABLED = "true";
    process.env.PAYPAL_MODE = "sandbox";
    expect(paypalIsAvailable()).toBe(false);
  });

  it("uses the official Live endpoint without consulting Sandbox storage", () => {
    process.env.PAYPAL_ENABLED = "true";
    process.env.PAYPAL_MODE = "live";
    process.env.PAYPAL_CLIENT_ID = "live-client";
    process.env.PAYPAL_CLIENT_SECRET = "live-secret";
    process.env.PAYPAL_MERCHANT_ID = "live-merchant";
    process.env.PAYPAL_WEBHOOK_ID = "live-webhook";
    process.env.PAYPAL_ELIGIBLE_SELLER_ID = "seller-own-123";
    process.env.PAYPAL_IDR_PER_USD = "16000";
    expect(paypalConfig()).toMatchObject({ mode: "live", baseUrl: "https://api-m.paypal.com" });
    expect(paypalIsAvailable()).toBe(true);
  });

  it("refuses production storage for every Sandbox payment action", () => {
    process.env.PAYPAL_SANDBOX_STORAGE_ROOT = "/home/harnet/digital-store/storage";
    process.env.DIGITAL_STORAGE_ROOT = "/home/harnet/digital-store/storage";
    expect(() => assertPayPalSandboxStorage()).toThrow("bukan storage produksi");
    process.env.PAYPAL_SANDBOX_STORAGE_ROOT = "/tmp/paypal-sandbox-storage";
    process.env.DIGITAL_STORAGE_ROOT = "/tmp/paypal-sandbox-storage";
    expect(assertPayPalSandboxStorage()).toBe("/tmp/paypal-sandbox-storage");
  });

  it("accepts only a COMPLETED capture with exact amount, order reference, and merchant", () => {
    expect(validatePayPalCapture(capture(), expected)).toMatchObject({ captureId: "CAP-1", amount: "2.50" });
    expect(() => validatePayPalCapture(capture({ purchase_units: [{ reference_id: "KS-1", custom_id: "order-1", amount: { currency_code: "USD", value: "0.01" }, payee: { merchant_id: "MERCHANT-1" }, payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "0.01" } }] } }] }), expected)).toThrow("Referensi atau nominal");
    expect(() => validatePayPalCapture(capture({ purchase_units: [{ reference_id: "KS-1", custom_id: "order-1", amount: { currency_code: "USD", value: "2.50" }, payee: { merchant_id: "OTHER" }, payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "2.50" } }] } }] }), expected)).toThrow("merchant");
  });

  it("requires review rather than delivery for cancelled or late payments", () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    expect(paypalCaptureNeedsReview({ orderStatus: "PENDING", paymentStatus: "PENDING", createdAt, now: new Date("2026-10-01T00:09:59.999Z") })).toBe(false);
    expect(paypalCaptureNeedsReview({ orderStatus: "PENDING", paymentStatus: "PENDING", createdAt, now: new Date("2026-10-01T00:10:00Z") })).toBe(true);
    expect(paypalCaptureNeedsReview({ orderStatus: "CANCELLED", paymentStatus: "CANCELLED", createdAt })).toBe(true);
  });

  it("locks account-balance payment after a PayPal order is created", () => {
    expect(hasActivePayPalCheckout({ provider: "PAYPAL", externalId: "paypal:PP-1" })).toBe(true);
    expect(hasActivePayPalCheckout({ provider: "PAYPAL", externalId: null })).toBe(false);
  });
});
