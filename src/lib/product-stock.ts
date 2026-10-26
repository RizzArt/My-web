import type { Product, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inventoryBackedTypes } from "@/lib/inventory";

export const inventoryProductTypes: ProductType[] = inventoryBackedTypes;

export type ProductStock = {
  kind: "finite" | "inventory" | "unlimited";
  quantity: number | null;
  available: boolean;
};

export function stockForProduct(product: Pick<Product, "type" | "stock"> & { deliveryMode?: "AUTO" | "MANUAL" }, availableInventory = 0): ProductStock {
  if ((product.deliveryMode ?? "AUTO") === "AUTO" && inventoryProductTypes.includes(product.type)) return { kind: "inventory", quantity: availableInventory, available: availableInventory > 0 };
  if (product.stock === null) return { kind: "unlimited", quantity: null, available: true };
  return { kind: "finite", quantity: product.stock, available: product.stock > 0 };
}

export async function getAvailableInventoryMap(productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await prisma.digitalInventory.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, status: "AVAILABLE", isSold: false, assignedOrderId: null },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.productId, row._count._all]));
}

export async function attachStock<T extends Pick<Product, "id" | "type" | "stock"> & { deliveryMode?: "AUTO" | "MANUAL" }>(products: T[]) {
  const inventory = await getAvailableInventoryMap(products.filter((product) => (product.deliveryMode ?? "AUTO") === "AUTO" && inventoryProductTypes.includes(product.type)).map((product) => product.id));
  return products.map((product) => ({ ...product, stockInfo: stockForProduct(product, inventory.get(product.id) ?? 0) }));
}

export function stockLabel(stock: ProductStock) {
  if (stock.kind === "unlimited") return "Stok tersedia";
  if (stock.quantity === 0) return "Habis";
  if (stock.kind === "inventory") return stock.quantity && stock.quantity <= 5 ? `Tersisa ${stock.quantity}` : `Stok: ${stock.quantity}`;
  return stock.quantity && stock.quantity <= 5 ? `Tersisa ${stock.quantity}` : `Stok: ${stock.quantity}`;
}
