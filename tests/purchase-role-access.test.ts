import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cancel: vi.fn(),
  requestCancellation: vi.fn(),
  wallet: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/customer-cancellation", () => ({
  cancelUnpaidOrder: mocks.cancel,
  requestPaidCancellation: mocks.requestCancellation,
}));
vi.mock("@/lib/customer-wallet", () => ({
  payOrderWithBalance: mocks.wallet,
}));

import { POST as cancel } from "@/app/api/orders/[orderId]/cancel/route";
import { POST as wallet } from "@/app/api/orders/[orderId]/wallet-payment/route";

const routes = [
  { name: "cancel", handler: cancel, service: mocks.cancel },
  { name: "wallet", handler: wallet, service: mocks.wallet },
];

function request() {
  return new Request("http://localhost/api/orders/order-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

describe("purchase actions use the authenticated owner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cancel.mockResolvedValue({ status: "CANCELLED" });
    mocks.wallet.mockResolvedValue({ orderId: "order-1" });
  });

  for (const route of routes) {
    for (const role of ["CUSTOMER", "SELLER", "ADMIN"]) {
      it(`${route.name}: ${role} passes its own user ID`, async () => {
        mocks.auth.mockResolvedValue({ user: { id: "owner-1", role } });
        const response = await route.handler(
          request(), { params: Promise.resolve({ orderId: "order-1" }) },
        );
        expect(response.status).toBe(200);
        expect(route.service).toHaveBeenCalledWith("order-1", "owner-1");
      });
    }

    it(`${route.name}: requires login`, async () => {
      mocks.auth.mockResolvedValue(null);
      const response = await route.handler(
        request(), { params: Promise.resolve({ orderId: "order-1" }) },
      );
      expect(response.status).toBe(401);
      expect(route.service).not.toHaveBeenCalled();
    });

    it(`${route.name}: preserves rejection from the ownership service`, async () => {
      mocks.auth.mockResolvedValue({ user: { id: "other-user", role: "SELLER" } });
      route.service.mockRejectedValue(new Error("Pesanan tidak ditemukan."));
      const response = await route.handler(
        request(), { params: Promise.resolve({ orderId: "order-1" }) },
      );
      expect(response.status).toBe(400);
      expect(route.service).toHaveBeenCalledWith("order-1", "other-user");
      expect(await response.json()).toMatchObject({
        error: "Pesanan tidak ditemukan.",
      });
    });
  }
});
