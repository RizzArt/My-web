import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publishNotification } from "@/lib/realtime/publish";

const input = z.object({ action: z.enum(["APPROVE", "REJECT"]), rejectionReason: z.string().trim().min(1).max(500).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  const session = await auth();
  if (!session?.user.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.action === "REJECT" && !parsed.data.rejectionReason)) return NextResponse.json({ error: "Alasan penolakan wajib diisi." }, { status: 400 });
  const { promotionId } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.promotion.findUnique({ where: { id: promotionId }, include: { seller: { include: { user: true } }, product: { select: { name: true } } } });
      if (!current || current.status !== "PENDING") throw new Error("Promosi tidak tersedia untuk diproses.");
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${current.sellerId} FOR UPDATE`;
      if (parsed.data.action === "APPROVE") {
        const startsAt = new Date();
        const endsAt = new Date(startsAt.getTime() + current.durationDays * 86400000);
        const updated = await tx.promotion.update({ where: { id: current.id }, data: { status: "ACTIVE", startsAt, endsAt, approvedAt: startsAt, approvedById: session.user.id } });
        await tx.sellerWalletTransaction.create({ data: { sellerId: current.sellerId, type: "PROMOTION_CHARGED", amount: 0, referenceType: "Promotion", referenceId: current.id, description: `Promotion charged: ${current.product.name}` } });
        const notification = await tx.notification.create({ data: { userId: current.seller.userId, title: "Promosi Disetujui", message: `Promosi produk ${current.product.name} aktif selama ${current.durationDays} hari.`, type: "PROMOTION", link: "/seller/promotions" } });
        await tx.auditLog.create({ data: { actorId: session.user.id, action: "PROMOTION_APPROVED", entityType: "Promotion", entityId: current.id, metadata: { durationDays: current.durationDays } } });
        return { updated, notification };
      }
      const updated = await tx.promotion.update({ where: { id: current.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: parsed.data.rejectionReason } });
      await tx.sellerWalletTransaction.create({ data: { sellerId: current.sellerId, type: "PROMOTION_RELEASED", amount: current.price, referenceType: "Promotion", referenceId: current.id, description: "Promotion rejected; reservation released" } });
      const notification = await tx.notification.create({ data: { userId: current.seller.userId, title: "Promosi Ditolak", message: `Promosi produk ${current.product.name} ditolak. Alasan: ${parsed.data.rejectionReason}`, type: "PROMOTION", link: "/seller/promotions" } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "PROMOTION_REJECTED", entityType: "Promotion", entityId: current.id, metadata: { rejectionReason: parsed.data.rejectionReason } } });
      return { updated, notification };
    }, { isolationLevel: "Serializable" });
    await publishNotification(result.notification);
    return NextResponse.json({ ok: true, status: result.updated.status });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Promosi gagal diproses." }, { status: 400 }); }
}
