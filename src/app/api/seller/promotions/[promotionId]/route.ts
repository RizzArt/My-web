import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  const session = await auth();
  if (!session?.user.id || session.user.role !== "SELLER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { promotionId } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const promotion = await tx.promotion.findFirst({ where: { id: promotionId, seller: { userId: session.user.id } } });
      if (!promotion) throw new Error("Promosi tidak ditemukan.");
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${promotion.sellerId} FOR UPDATE`;
      if (promotion.status !== "PENDING") throw new Error("Hanya promosi pending yang dapat dibatalkan.");
      await tx.promotion.update({ where: { id: promotion.id }, data: { status: "CANCELLED" } });
      await tx.sellerWalletTransaction.create({ data: { sellerId: promotion.sellerId, type: "PROMOTION_RELEASED", amount: promotion.price, referenceType: "Promotion", referenceId: promotion.id, description: "Promotion cancelled; reservation released" } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "PROMOTION_CANCELLED", entityType: "Promotion", entityId: promotion.id } });
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Promosi gagal dibatalkan." }, { status: 400 }); }
}
