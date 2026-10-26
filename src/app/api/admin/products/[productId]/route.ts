import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteManagedProductImages, isManagedProductImage } from "@/lib/storage/storage";

export async function DELETE(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { productId } = await params;
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { _count: { select: { orderItems: true, inventory: true, reviews: true, promotions: true } } } });
  if (!product) return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  if (product._count.orderItems || product._count.reviews || product._count.promotions) return NextResponse.json({ error: "Produk memiliki riwayat transaksi dan tidak dapat dihapus permanen. Arsipkan produk sebagai gantinya." }, { status: 409 });
  const images = [product.thumbnailUrl, ...(Array.isArray(product.galleryUrls) ? product.galleryUrls.filter((url): url is string => typeof url === "string") : [])];
  await prisma.$transaction(async (tx) => {
    await tx.conversation.updateMany({ where: { productId }, data: { productId: null } });
    await tx.product.delete({ where: { id: productId } });
    await tx.auditLog.create({ data: { actorId: session.user.id, action: "PRODUCT_DELETED", entityType: "Product", entityId: productId } });
  });
  await deleteManagedProductImages(images.filter((url): url is string => isManagedProductImage(url)));
  return NextResponse.json({ ok: true });
}
