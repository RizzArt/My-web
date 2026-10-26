import { notFound } from "next/navigation";
import { requireSeller } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/secrets";
import { maskInventoryValue, inventoryBackedTypes } from "@/lib/inventory";
import { InventoryManager } from "@/components/inventory-manager";
export const dynamic = "force-dynamic";
export default async function SellerInventoryDetail({ params }: { params: Promise<{ productId: string }> }) { const session = await requireSeller(); const { productId } = await params; const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id } }); const product = await prisma.product.findFirst({ where: { id: productId, sellerId: seller?.id } }); if (!product || product.deliveryMode !== "AUTO" || !inventoryBackedTypes.includes(product.type)) notFound(); const items = await prisma.digitalInventory.findMany({ where: { productId }, select: { id: true, status: true, secretValue: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }); return <InventoryManager productId={product.id} productName={product.name} type={product.type} initialItems={items.map((item) => ({ ...item, secretValue: maskInventoryValue(decryptSecret(item.secretValue)), createdAt: item.createdAt.toISOString() }))} />; }
