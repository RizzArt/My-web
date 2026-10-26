import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { productData } from "@/lib/product-input";
import { deleteManagedProductImages, isManagedProductImage } from "@/lib/storage/storage";
import { uniqueProductSlug } from "@/lib/product-slug";
import { getAvailableInventoryMap, inventoryProductTypes, stockForProduct } from "@/lib/product-stock";

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await prisma.product.findFirst({ where: { id: productId, isPublished: true, moderationStatus: "APPROVED", ...activeSellerProductWhere() }, select: { id: true, type: true, stock: true, deliveryMode: true } });
  if (!product) return NextResponse.json({ error: "Produk tidak tersedia." }, { status: 404 });
  const inventory = product.deliveryMode === "AUTO" && inventoryProductTypes.includes(product.type) ? (await getAvailableInventoryMap([product.id])).get(product.id) ?? 0 : 0;
  const stock = stockForProduct(product, inventory);
  return NextResponse.json({ available: stock.available, stock: stock.quantity });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth(); if (!session?.user?.id || !["ADMIN", "SELLER"].includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { productId } = await params; const current = await prisma.product.findUnique({ where: { id: productId }, include: { seller: true } });
  if (!current || (session.user.role === "SELLER" && current.seller?.userId !== session.user.id)) return NextResponse.json({ error: "Product tidak ditemukan." }, { status: 404 });
  let data: ReturnType<typeof productData> | undefined;
  try {
    const parsedData = productData(await request.json());
    data = parsedData;
    const { sellerId: _ignoredSellerId, ...productDataWithoutOwnership } = parsedData;
    const next = await adminNotifiedTransaction(async (tx) => {
      const updated = await tx.product.update({ where: { id: productId }, data: session.user.role === "SELLER" ? { ...productDataWithoutOwnership, slug: await uniqueProductSlug(tx, parsedData.name, productId), sellerId: current.sellerId, isPublished: false, moderationStatus: "PENDING_REVIEW", rejectionReason: null } : { ...productDataWithoutOwnership, slug: await uniqueProductSlug(tx, parsedData.name, productId) } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "PRODUCT_UPDATED", entityType: "Product", entityId: productId } });
      return updated;
    }, (result) => session.user.role === "SELLER" ? ({
      eventKey: `product-resubmitted:${result.id}:${result.updatedAt.toISOString()}`,
      title: "Produk Seller Diajukan Ulang",
      message: "Perubahan produk seller menunggu review admin.",
      link: `/admin/products/${result.id}/review`
    }) : null);
    const oldImages = [current.thumbnailUrl, ...(Array.isArray(current.galleryUrls) ? current.galleryUrls.filter((url): url is string => typeof url === "string") : [])];
    const newImages = [next.thumbnailUrl, ...(Array.isArray(next.galleryUrls) ? next.galleryUrls.filter((url): url is string => typeof url === "string") : [])];
    await deleteManagedProductImages(oldImages.filter((url): url is string => isManagedProductImage(url) && !newImages.includes(url)));
    return NextResponse.json({ product: next });
  } catch (error) { if (data) { const oldImages = [current.thumbnailUrl, ...(Array.isArray(current.galleryUrls) ? current.galleryUrls.filter((url): url is string => typeof url === "string") : [])]; await deleteManagedProductImages([data.thumbnailUrl, ...data.galleryUrls].filter((url): url is string => isManagedProductImage(url) && !oldImages.includes(url))); } return NextResponse.json({ error: error instanceof Error ? error.message : "Produk tidak valid." }, { status: 400 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth(); if (!session?.user?.id || !["ADMIN", "SELLER"].includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); const { productId } = await params;
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { seller: true, _count: { select: { orderItems: true, inventory: true } } } }); if (!product || (session.user.role === "SELLER" && product.seller?.userId !== session.user.id)) return NextResponse.json({ error: "Product tidak ditemukan." }, { status: 404 }); if (product._count.orderItems || product._count.inventory) return NextResponse.json({ error: "Produk dengan order/inventory tidak aman dihapus. Nonaktifkan saja." }, { status: 409 }); await prisma.product.delete({ where: { id: productId } }); return NextResponse.json({ ok: true });
}
