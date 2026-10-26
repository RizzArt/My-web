import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  generate: vi.fn(),
  verify: vi.fn(),
  image: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/payments/sociabuzz-service", () => ({
  generateSociaBuzzQr: mocks.generate,
  verifySociaBuzzOrder: mocks.verify,
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: mocks.image },
}));

import { POST } from "@/app/api/orders/[orderId]/sociabuzz/route";

function request() {
  return new Request("http://localhost/api/orders/order-1/sociabuzz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.image.mockResolvedValue("data:image/png;base64,test");
  mocks.generate.mockResolvedValue({
    status: "pending",
    invoiceId: "TRIBE-IDR-TEST-123",
    qrCode: "test",
    amount: 15000,
    totalPay: 15105,
    createdAt: Date.now(),
  });
});

describe("QRIS access for the order owner", () => {
  it.each(["CUSTOMER", "SELLER", "ADMIN"])(
    "passes the authenticated %s owner to the payment service",
    async (role) => {
      mocks.auth.mockResolvedValue({ user: { id: "owner-1", role } });
      const response = await POST(request(), {
        params: Promise.resolve({ orderId: "order-1" }),
      });
      expect(response.status).toBe(200);
      expect(mocks.generate).toHaveBeenCalledWith("order-1", "owner-1");
    },
  );

  it("rejects requests without a login", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(request(), {
      params: Promise.resolve({ orderId: "order-1" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not return a QR when the service rejects order ownership", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "other-user", role: "SELLER" },
    });
    mocks.generate.mockRejectedValue(new Error("Pesanan tidak ditemukan."));
    const response = await POST(request(), {
      params: Promise.resolve({ orderId: "order-1" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.generate).toHaveBeenCalledWith("order-1", "other-user");
    expect(mocks.image).not.toHaveBeenCalled();
  });
});
