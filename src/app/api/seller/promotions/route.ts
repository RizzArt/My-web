import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { availableBalance } from "@/lib/seller-finance";
import { completeExpiredPromotions, promotionPrice } from "@/lib/promotions";
import { isManagedProductImage } from "@/lib/storage/storage";
import { publishNotification } from "@/lib/realtime/publish";

const input = z.object({
  productId: z.string().cuid(),
  durationDays: z.coerce.number().int().refine((value) => promotionPrice(value) !== null, "Paket promosi tidak valid."),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(240).optional().or(z.literal("")),
  ctaText: z.string().trim().max(40).optional().or(z.literal("")),
  bannerUrl: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user.id || session.user.role !== "SELLER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data promosi tidak valid." }, { status: 400 });
  const price = promotionPrice(parsed.data.durationDays);
  if (price === null) return NextResponse.json({ error: "Paket promosi tidak valid." }, { status: 400 });
  if (parsed.data.bannerUrl && !isManagedProductImage(parsed.data.bannerUrl)) return NextResponse.json({ error: "Banner promosi tidak valid." }, { status: 400 });
  try {
    const transactionResult = await adminNotifiedTransaction(async (tx) => {
      const seller = await tx.sellerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true, userId: true } });
      if (!seller) throw new Error("Seller tidak ditemukan.");
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${seller.id} FOR UPDATE`;
      await completeExpiredPromotions(tx, seller.id);
      const product = await tx.product.findFirst({ where: { id: parsed.data.productId, sellerId: seller.id, moderationStatus: "APPROVED", isPublished: true }, select: { id: true, name: true } });
      if (!product) throw new Error("Produk harus milik seller, approved, dan aktif.");
      const duplicate = await tx.promotion.findFirst({ where: { sellerId: seller.id, productId: product.id, status: { in: ["PENDING", "ACTIVE"] } }, select: { id: true } });
      if (duplicate) throw new Error("Produk ini sudah memiliki promosi pending atau aktif.");
      const available = await availableBalance(tx, seller.id);
      if (available < price) throw new Error("Saldo tidak mencukupi.");
      const promotion = await tx.promotion.create({ data: { sellerId: seller.id, productId: product.id, durationDays: parsed.data.durationDays, price, title: parsed.data.title, subtitle: parsed.data.subtitle || null, ctaText: parsed.data.ctaText || null, bannerUrl: parsed.data.bannerUrl || null } });
      await tx.sellerWalletTransaction.create({ data: { sellerId: seller.id, type: "PROMOTION_RESERVED", amount: -price, referenceType: "Promotion", referenceId: promotion.id, description: `Promotion reserved: ${product.name}` } });
      const notification = await tx.notification.create({ data: { userId: seller.userId, title: "Pengajuan Promosi Dikirim", message: `Promosi produk ${product.name} sedang menunggu persetujuan admin.`, type: "PROMOTION", link: "/seller/promotions" } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "PROMOTION_SUBMITTED", entityType: "Promotion", entityId: promotion.id, metadata: { productId: product.id, durationDays: promotion.durationDays } } });
      return { promotion, notification };
    }, (result) => ({
       eventKey: `promotion-request:${result.promotion.id}`,
       title: "Pengajuan Promosi Baru",
       message: "Ada pengajuan promosi yang menunggu persetujuan.",
       link: `/admin/promotions/${result.promotion.id}`
     }), { isolationLevel: "Serializable" });
    await publishNotification(transactionResult.notification);
    return NextResponse.json({ ok: true, promotionId: transactionResult.promotion.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pengajuan promosi gagal." }, { status: 400 });
  }
}
