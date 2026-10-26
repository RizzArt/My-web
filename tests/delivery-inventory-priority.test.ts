import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { claimDeliveryInventory } from "@/lib/delivery/claim-inventory";

function mockTx() {
  const findFirst = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { digitalInventory: { findFirst, updateMany } };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    findFirst,
    updateMany,
  };
}

describe("delivery inventory reservation priority", () => {
  it("uses the reserved inventory without querying available stock", async () => {
    const m = mockTx();
    m.findFirst.mockResolvedValue({ id: "reserved-1" });
    const result = await claimDeliveryInventory(
      m.tx, "order-1", "item-1", "product-1", "Product"
    );
    expect(result.id).toBe("reserved-1");
    expect(m.findFirst).toHaveBeenCalledTimes(1);
    expect(m.findFirst.mock.calls[0][0].where).toEqual({
      productId: "product-1",
      status: "ASSIGNED",
      isSold: false,
      assignedOrderId: "order-1",
      assignedOrderItemId: "item-1",
    });
    expect(m.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "reserved-1",
      status: "ASSIGNED",
      assignedOrderId: "order-1",
      assignedOrderItemId: "item-1",
      isSold: false,
    });
  });

  it("falls back only to available stock without an owner", async () => {
    const m = mockTx();
    m.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "available-1" });
    await claimDeliveryInventory(
      m.tx, "order-1", "item-1", "product-1", "Product"
    );
    expect(m.findFirst).toHaveBeenCalledTimes(2);
    expect(m.updateMany.mock.calls[0][0].where).toEqual({
      id: "available-1",
      productId: "product-1",
      status: "AVAILABLE",
      isSold: false,
      assignedOrderId: null,
      assignedOrderItemId: null,
    });
  });

  it("stops if no eligible inventory exists", async () => {
    const m = mockTx();
    m.findFirst.mockResolvedValue(null);
    await expect(claimDeliveryInventory(
      m.tx, "order-1", "item-1", "product-1", "Product"
    )).rejects.toThrow("Insufficient inventory");
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("stops when another transaction has already claimed the item", async () => {
    const m = mockTx();
    m.findFirst.mockResolvedValue({ id: "reserved-1" });
    m.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimDeliveryInventory(
      m.tx, "order-1", "item-1", "product-1", "Product"
    )).rejects.toThrow("claimed concurrently");
    expect(m.findFirst).toHaveBeenCalledTimes(1);
  });
});
