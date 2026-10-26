import { prisma } from "@/lib/prisma";

type SellerClient = Pick<typeof prisma, "sellerProfile">;

export type PayPalOrderItem = { product: { sellerId: string | null } | null };

export function paypalEligibleSellerId() {
  const sellerId = process.env.PAYPAL_ELIGIBLE_SELLER_ID?.trim();
  if (!sellerId) throw new Error("Konfigurasi PayPal PAYPAL_ELIGIBLE_SELLER_ID belum lengkap.");
  return sellerId;
}

export function hasOnlyPayPalEligibleSeller(items: PayPalOrderItem[], sellerId = paypalEligibleSellerId()) {
  return items.length > 0 && items.every((item) => item.product?.sellerId === sellerId);
}

// Check the configured merchant seller in the same database operation that
// authorizes checkout, so a stale environment value cannot enable PayPal.
export async function assertPayPalEligibleSeller(client: SellerClient = prisma) {
  const sellerId = paypalEligibleSellerId();
  const seller = await client.sellerProfile.findFirst({
    where: { id: sellerId, isActive: true, isVerified: true },
    select: { id: true },
  });
  if (!seller) throw new Error("Seller PayPal yang dikonfigurasi tidak aktif atau tidak terverifikasi.");
  return sellerId;
}

export async function assertPayPalEligibleOrderItems(items: PayPalOrderItem[], client: SellerClient = prisma) {
  const sellerId = await assertPayPalEligibleSeller(client);
  if (!hasOnlyPayPalEligibleSeller(items, sellerId)) {
    throw new Error("PayPal hanya tersedia untuk produk seller merchant yang dikonfigurasi.");
  }
  return sellerId;
}

export async function canUsePayPalForProductIds(productIds: string[]) {
  if (productIds.length === 0 || new Set(productIds).size !== productIds.length) return false;
  try {
    const sellerId = await assertPayPalEligibleSeller();
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, sellerId, isPublished: true, moderationStatus: "APPROVED" },
      select: { id: true },
    });
    return products.length === productIds.length;
  } catch {
    return false;
  }
}
