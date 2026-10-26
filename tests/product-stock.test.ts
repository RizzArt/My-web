import { afterEach, describe, expect, it, vi } from "vitest";
import { attachStock, stockForProduct, stockLabel } from "@/lib/product-stock";
import { prisma } from "@/lib/prisma";

describe("product stock display rules", () => {
  afterEach(() => vi.restoreAllMocks());
  it("shows finite stock and low-stock label", () => {
    expect(stockLabel(stockForProduct({ type: "FILE", stock: 12 }))).toBe("Stok: 12");
    expect(stockLabel(stockForProduct({ type: "FILE", stock: 5 }))).toBe("Tersisa 5");
  });
  it("shows out of stock without inventing availability", () => {
    expect(stockForProduct({ type: "FILE", stock: 0 }).available).toBe(false);
    expect(stockLabel(stockForProduct({ type: "LICENSE_KEY", stock: null }, 0))).toBe("Habis");
  });
  it("uses available inventory for inventory-backed products", () => {
    expect(stockLabel(stockForProduct({ type: "VOUCHER", stock: 999 }, 3))).toBe("Tersisa 3");
    expect(stockForProduct({ type: "ACCOUNT", stock: null }, 9).quantity).toBe(9);
  });
  it("treats a FILE without manual stock as unlimited", () => {
    const stock = stockForProduct({ type: "FILE", stock: null });
    expect(stock.kind).toBe("unlimited");
    expect(stockLabel(stock)).toBe("Stok tersedia");
  });
  it("preserves catalog order when attaching inventory stock", async () => {
    vi.spyOn(prisma.digitalInventory, "groupBy").mockResolvedValue([
      { productId: "second", _count: { _all: 3 } },
    ] as never);
    const products = await attachStock([
      { id: "first", type: "FILE", stock: null },
      { id: "second", type: "VOUCHER", stock: 10 },
      { id: "third", type: "FILE", stock: 0 },
    ]);
    expect(products.map((product) => product.id)).toEqual(["first", "second", "third"]);
  });
});
