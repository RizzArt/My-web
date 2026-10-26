import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, hashSecret } from "@/lib/security/secrets";
import { inventoryBackedTypes, inventoryValueHash, parseInventoryValues, maskInventoryValue } from "@/lib/inventory";
import { decryptSecret } from "@/lib/security/secrets";
import { z } from "zod";

const input = z.object({ productId: z.string().min(1), values: z.string().max(600000).optional(), secretValue: z.string().trim().max(10000).optional() });
async function sellerFor(session: { user?: { role?: string; id?: string } } | null) { return session?.user?.role === "SELLER" && session.user.id ? prisma.sellerProfile.findUnique({ where: { userId: session.user.id } }) : null; }

export async function GET(request: Request) {
  const seller = await sellerFor(await auth()); if (!seller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const productId = new URL(request.url).searchParams.get("productId");
  const inventory = await prisma.digitalInventory.findMany({ where: { product: { sellerId: seller.id }, ...(productId ? { productId } : {}) }, select: { id: true, productId: true, secretValue: true, status: true, isSold: true, assignedOrderId: true, createdAt: true, product: { select: { name: true, type: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ inventory: inventory.map((item) => ({ ...item, secretValue: maskInventoryValue(decryptSecret(item.secretValue)) })) });
}
export async function POST(request: Request) {
  const session = await auth(); const seller = await sellerFor(session); const actorId = session?.user?.id; if (!seller || !actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Data inventory tidak valid." }, { status: 400 });
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, sellerId: seller.id } });
  if (!product || product.deliveryMode !== "AUTO" || !inventoryBackedTypes.includes(product.type)) return NextResponse.json({ error: "Produk bukan inventory-backed AUTO milik seller." }, { status: 403 });
  const result = parseInventoryValues(parsed.data.values ?? parsed.data.secretValue ?? "", product.type); if (!result.values.length) return NextResponse.json({ error: "Tidak ada data stok valid.", added: 0, duplicate: 0, invalid: result.invalid }, { status: 400 });
  const hashes = result.values.map(inventoryValueHash); const existing = await prisma.digitalInventory.findMany({ where: { productId: product.id, valueHash: { in: hashes } }, select: { valueHash: true } }); const existingHashes = new Set(existing.map((item) => item.valueHash).filter((value): value is string => Boolean(value)));
  const fresh = result.values.filter((value) => !existingHashes.has(inventoryValueHash(value))); const duplicate = result.duplicate + result.values.length - fresh.length;
  if (fresh.length) await prisma.$transaction(async (tx) => { const created = await tx.digitalInventory.createMany({ data: fresh.map((value) => ({ productId: product.id, secretValue: encryptSecret(value), valueHash: hashSecret(value.trim().toLowerCase()) })) }); await tx.auditLog.create({ data: { actorId, action: "SELLER_INVENTORY_CREATED", entityType: "Product", entityId: product.id, metadata: { added: created.count, duplicate, invalid: result.invalid } } }); });
  return NextResponse.json({ added: fresh.length, duplicate, invalid: result.invalid, detected: result.values.length }, { status: 201 });
}
export async function DELETE(request: Request) {
  const seller = await sellerFor(await auth()); if (!seller) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); const body = await request.json().catch(() => null) as { id?: string; ids?: string[] } | null; const ids = body?.ids?.length ? body.ids : body?.id ? [body.id] : [];
  if (!ids.length || ids.length > 500) return NextResponse.json({ error: "Inventory tidak valid." }, { status: 400 }); const result = await prisma.digitalInventory.deleteMany({ where: { id: { in: ids }, status: "AVAILABLE", product: { sellerId: seller.id } } }); return NextResponse.json({ deleted: result.count, skipped: ids.length - result.count });
}
