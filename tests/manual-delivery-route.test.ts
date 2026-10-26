import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), manuallyDeliver: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/delivery/service", () => ({ manuallyDeliver: mocks.manuallyDeliver }));

import { POST } from "@/app/api/orders/[orderId]/manual-delivery/route";

const context = { params: Promise.resolve({ orderId: "order-1" }) };
const request = () => new Request("http://localhost/api/orders/order-1/manual-delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ deliveryId: "delivery-1", message: "Produk dikirim" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "seller-owner", role: "SELLER" } });
  mocks.manuallyDeliver.mockResolvedValue({ id: "delivery-1" });
});

describe("manual delivery API authorization", () => {
  it("allows the seller owner to submit their manual delivery", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.manuallyDeliver).toHaveBeenCalledWith("order-1", "delivery-1", "seller-owner", "SELLER", expect.objectContaining({ message: "Produk dikirim" }));
  });

  it("returns forbidden when another seller targets a private delivery", async () => {
    mocks.manuallyDeliver.mockRejectedValue(new Error("Seller tidak memiliki produk ini."));

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Seller tidak memiliki produk ini." });
  });
});
