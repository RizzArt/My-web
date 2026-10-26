import type { Prisma } from "@prisma/client";

export async function claimDeliveryInventory(
  tx: Prisma.TransactionClient,
  orderId: string,
  orderItemId: string,
  productId: string,
  productName: string
) {
  const reservedWhere = {
    productId,
    status: "ASSIGNED" as const,
    isSold: false,
    assignedOrderId: orderId,
    assignedOrderItemId: orderItemId,
  };
  const availableWhere = {
    productId,
    status: "AVAILABLE" as const,
    isSold: false,
    assignedOrderId: null,
    assignedOrderItemId: null,
  };
  const orderBy: Prisma.DigitalInventoryOrderByWithRelationInput[] = [
    { createdAt: "asc" },
    { id: "asc" },
  ];

  const reserved = await tx.digitalInventory.findFirst({
    where: reservedWhere,
    orderBy,
  });
  const inventory = reserved ?? await tx.digitalInventory.findFirst({
    where: availableWhere,
    orderBy,
  });

  if (!inventory) {
    throw new Error(`Insufficient inventory for ${productName}`);
  }

  const claimed = await tx.digitalInventory.updateMany({
    where: {
      id: inventory.id,
      ...(reserved ? reservedWhere : availableWhere),
    },
    data: {
      status: "DELIVERED",
      isSold: true,
      assignedOrderId: orderId,
      assignedOrderItemId: orderItemId,
      assignedAt: new Date(),
    },
  });

  if (claimed.count !== 1) {
    throw new Error("Inventory was claimed concurrently; retry delivery");
  }
  return inventory;
}
