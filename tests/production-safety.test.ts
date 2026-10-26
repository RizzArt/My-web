import { afterEach, describe, expect, it } from "vitest";
import { customerPaymentsAvailable } from "@/lib/payments/provider";

const original = { nodeEnv: process.env.NODE_ENV, provider: process.env.PAYMENT_PROVIDER, mode: process.env.MANUAL_PAYMENT_TEST_MODE, key: process.env.MIDTRANS_SERVER_KEY };
afterEach(() => { process.env.NODE_ENV = original.nodeEnv; process.env.PAYMENT_PROVIDER = original.provider; process.env.MANUAL_PAYMENT_TEST_MODE = original.mode; process.env.MIDTRANS_SERVER_KEY = original.key; });

describe("production payment safety", () => {
  it("does not allow manual payment checkout in production when test mode is off", () => {
    process.env.NODE_ENV = "production"; process.env.PAYMENT_PROVIDER = "manual"; process.env.MANUAL_PAYMENT_TEST_MODE = "false";
    expect(customerPaymentsAvailable()).toBe(false);
  });

  it("requires the real provider credential in production", () => {
    process.env.NODE_ENV = "production"; process.env.PAYMENT_PROVIDER = "midtrans"; delete process.env.MIDTRANS_SERVER_KEY;
    expect(customerPaymentsAvailable()).toBe(false);
    process.env.MIDTRANS_SERVER_KEY = "configured";
    expect(customerPaymentsAvailable()).toBe(true);
  });
});
