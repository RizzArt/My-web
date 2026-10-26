import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ marker: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { payPalSandboxEnvironment: { findUnique: mocks.marker } } }));
vi.mock("@/lib/delivery/service", () => ({ deliverOrder: vi.fn() }));
vi.mock("@/lib/seller-finance", () => ({ createSellerEarningsForPaidOrder: vi.fn() }));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: vi.fn() }));
vi.mock("@/lib/customer-cancellation", () => ({ autoCancelExpiredOrder: vi.fn() }));

import { assertPayPalSandboxEnvironment } from "@/lib/payments/paypal-service";

beforeEach(() => {
  process.env.PAYPAL_SANDBOX_STORAGE_ROOT = "/tmp/paypal-sandbox-storage";
  process.env.DIGITAL_STORAGE_ROOT = "/tmp/paypal-sandbox-storage";
  process.env.PAYPAL_SANDBOX_INSTANCE_ID = "isolated-sandbox-1234";
  mocks.marker.mockReset();
});

afterEach(() => {
  delete process.env.PAYPAL_SANDBOX_STORAGE_ROOT;
  delete process.env.DIGITAL_STORAGE_ROOT;
  delete process.env.PAYPAL_SANDBOX_INSTANCE_ID;
});

describe("PayPal Sandbox production isolation", () => {
  it("refuses a database without the isolated Sandbox marker", async () => {
    mocks.marker.mockResolvedValue(null);
    await expect(assertPayPalSandboxEnvironment()).rejects.toThrow("bukan instance");
  });

  it("refuses a marker belonging to another database instance", async () => {
    mocks.marker.mockResolvedValue({ instanceId: "other-sandbox-1234" });
    await expect(assertPayPalSandboxEnvironment()).rejects.toThrow("bukan instance");
  });

  it("allows only the configured isolated database marker", async () => {
    mocks.marker.mockResolvedValue({ instanceId: "isolated-sandbox-1234" });
    await expect(assertPayPalSandboxEnvironment()).resolves.toBeUndefined();
  });
});
