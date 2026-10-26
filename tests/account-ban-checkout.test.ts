import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  products: vi.fn(),
  transaction: vi.fn(),
  inventory: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: mocks.products }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/payments/provider", () => ({
  customerPaymentsAvailable: () => true,
  paymentProviderName: () => "qris_manual",
  getPaymentProvider: vi.fn(),
}));
vi.mock("@/lib/product-stock", () => ({
  getAvailableInventoryMap: mocks.inventory,
  inventoryProductTypes: [],
}));
import { createCheckout } from "@/lib/payments/checkout";

const input = {
  items: [{ productId: "product", quantity: 1 }],
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  customerEmailConfirmation: "buyer@example.com",
};
const product = {
  id: "product", name: "Produk", price: 15000,
  stock: null, deliveryMode: "MANUAL", type: "ACCOUNT",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.inventory.mockResolvedValue(new Map());
});

describe("account ban checkout enforcement", () => {
  it("rejects products excluded by the active seller filter", async () => {
    mocks.products.mockResolvedValue([]);
    await expect(createCheckout({ id: "buyer" }, input)).rejects.toThrow("unavailable");
    const conditions = mocks.products.mock.calls[0][0].where.AND[0].OR;
    expect(conditions).toContainEqual({ sellerId: null });
    expect(conditions).toContainEqual({
      seller: { is: {
        isActive: true,
        user: { is: { isActive: true, role: "SELLER" } },
      } },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a buyer banned after the initial request", async () => {
    mocks.products.mockResolvedValue([product]);
    const create = vi.fn();
    mocks.transaction.mockImplementation(async (operation) => operation({
      user: { findUnique: vi.fn().mockResolvedValue({ isActive: false }) },
      order: { create },
    }));
    await expect(createCheckout({ id: "buyer" }, input)).rejects.toThrow("Akun tidak aktif");
    expect(create).not.toHaveBeenCalled();
  });

  it("rechecks seller eligibility before creating an order", async () => {
    mocks.products.mockResolvedValue([product]);
    const create = vi.fn();
    mocks.transaction.mockImplementation(async (operation) => operation({
      user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      order: { create },
    }));
    await expect(createCheckout({ id: "buyer" }, input)).rejects.toThrow("seller sudah tidak tersedia");
    expect(create).not.toHaveBeenCalled();
  });
});
