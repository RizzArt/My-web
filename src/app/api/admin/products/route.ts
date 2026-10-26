import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { productData } from "@/lib/product-input";
import { deleteManagedProductImages } from "@/lib/storage/storage";
import { uniqueProductSlug } from "@/lib/product-slug";

export async function POST(request: Request) {
  const session = await auth(); if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return NextResponse.json({ error: "Permintaan create tidak valid." }, { status: 400 });
  if (idempotencyKey) {
    const previous = await prisma.auditLog.findFirst({ where: { actorId: session.user.id, action: "PRODUCT_CREATE_IDEMPOTENCY", entityType: "ProductCreate", metadata: { path: ["idempotencyKey"], equals: idempotencyKey } }, select: { entityId: true } });
    if (previous) {
      const product = await prisma.product.findUnique({ where: { id: previous.entityId } });
      if (product) return NextResponse.json({ product });
    }
  }
  let data: ReturnType<typeof productData> | undefined;
  try { const parsedData = productData(await request.json()); data = parsedData; const { sellerId: _ignoredSellerId, ...platformProductData } = parsedData; const product = await prisma.$transaction(async (tx) => { const created = await tx.product.create({ data: { ...platformProductData, slug: await uniqueProductSlug(tx, parsedData.name), sellerId: null, moderationStatus: "APPROVED", isPublished: true } }); await tx.auditLog.create({ data: { actorId: session.user.id, action: "PRODUCT_CREATED", entityType: "Product", entityId: created.id } }); if (idempotencyKey) await tx.auditLog.create({ data: { actorId: session.user.id, action: "PRODUCT_CREATE_IDEMPOTENCY", entityType: "ProductCreate", entityId: created.id, metadata: { idempotencyKey } } }); return created; }); return NextResponse.json({ product }, { status: 201 }); } catch (error) { if (data) await deleteManagedProductImages([data.thumbnailUrl, ...data.galleryUrls]); return NextResponse.json({ error: error instanceof Error ? error.message : "Produk tidak valid." }, { status: 400 }); }
}
