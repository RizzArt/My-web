import { ProductModerationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeSellerProductWhere } from "@/lib/product-account-visibility";

export const RESERVED_SLUGS = new Set(["admin", "api", "cart", "checkout", "dashboard", "login", "products", "seller", "settings"]);
export function normalizeSlug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

export function productVisibilityWhere() {
  return { isPublished: true, moderationStatus: ProductModerationStatus.APPROVED, ...activeSellerProductWhere() };
}

export async function sellerForUser(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId } });
}
