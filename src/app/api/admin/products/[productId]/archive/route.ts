import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publishNotification } from "@/lib/realtime/publish";

const input = z.object({ action: z.enum(["ARCHIVE", "RESTORE"]), reason: z.string().trim().max(1000).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action archive tidak valid." }, { status: 400 });
  const { productId } = await params;
  const current = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sellerId: true, moderationStatus: true, isPublished: true } });
  if (!current) return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  const isArchive = parsed.data.action === "ARCHIVE";
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id: productId }, data: { isPublished: isArchive ? false : current.moderationStatus === "APPROVED" } });
    await tx.auditLog.create({ data: { actorId: session.user.id, action: isArchive ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED", entityType: "Product", entityId: productId, metadata: isArchive && parsed.data.reason ? { reason: parsed.data.reason } : undefined } });
    let notification: Awaited<ReturnType<typeof tx.notification.create>> | null = null;
    if (current.sellerId) {
      const seller = await tx.sellerProfile.findUnique({ where: { id: current.sellerId }, select: { userId: true } });
      if (seller) notification = await tx.notification.create({ data: { userId: seller.userId, title: isArchive ? "Produk Diarsipkan oleh Admin" : "Produk Dipulihkan", message: isArchive ? `${current.name} diarsipkan oleh admin${parsed.data.reason ? `: ${parsed.data.reason}` : "."}` : `${current.name} dipulihkan. Status moderation tetap berlaku.`, type: "PRODUCT_MODERATION", link: `/seller/products/${productId}/edit` } });
    }
    return { product: updated, notification };
  });
  if (result.notification) await publishNotification(result.notification);
  return NextResponse.json({ product: result.product });
}
