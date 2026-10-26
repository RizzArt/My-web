import type { Prisma, ProductModerationStatus } from "@prisma/client";

type ModerationTransaction = Pick<Prisma.TransactionClient, "product" | "auditLog" | "notification">;

export type SellerProductModerationInput = {
  productId: string;
  actorId: string;
  status: Extract<ProductModerationStatus, "APPROVED" | "REJECTED">;
  rejectionReason?: string;
};

/** Keep every moderation side effect in one transaction and use the updated row, not its outer initializer. */
export async function moderateSellerProduct(tx: ModerationTransaction, input: SellerProductModerationInput) {
  const current = await tx.product.findUnique({
    where: { id: input.productId },
    include: { seller: { select: { userId: true } } },
  });

  if (!current) return null;
  if (!current.sellerId || !current.seller?.userId) throw new Error("Hanya produk seller yang dapat dimoderasi.");
  if (current.moderationStatus !== "PENDING_REVIEW") throw new Error("Produk tidak sedang menunggu moderation.");
  if (input.status === "REJECTED" && !input.rejectionReason?.trim()) throw new Error("Alasan reject wajib diisi.");

  const updated = await tx.product.update({
    where: { id: input.productId },
    data: {
      moderationStatus: input.status,
      rejectionReason: input.status === "REJECTED" ? input.rejectionReason!.trim() : null,
      isPublished: input.status === "APPROVED",
    },
  });

  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: `PRODUCT_${input.status}`,
      entityType: "Product",
      entityId: updated.id,
      metadata: input.status === "REJECTED" ? { rejectionReason: input.rejectionReason!.trim() } : undefined,
    },
  });

  const notification = await tx.notification.create({
    data: {
      userId: current.seller.userId,
      title: input.status === "APPROVED" ? "Produk Disetujui" : "Produk Perlu Diperbaiki",
      message: input.status === "APPROVED"
        ? `Produk ${current.name} telah disetujui dan dapat ditampilkan di toko.`
        : `Produk ${current.name} perlu diperbaiki. Alasan: ${input.rejectionReason!.trim()}`,
      type: "PRODUCT_MODERATION",
      link: `/seller/products/${updated.id}/edit`,
    },
  });

  return { ...updated, notification };
}
