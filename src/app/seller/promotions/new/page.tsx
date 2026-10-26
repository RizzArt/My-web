import Link from "next/link";
import { requireSeller } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { balanceSummary } from "@/lib/seller-finance";
import { PromotionForm } from "@/components/promotion-form";
import { completeExpiredPromotions } from "@/lib/promotions";

export const dynamic = "force-dynamic";
export default async function NewPromotionPage() { const session = await requireSeller(); const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id } }); if (!seller) return null; await prisma.$transaction((tx) => completeExpiredPromotions(tx, seller.id)); const [products, summary] = await Promise.all([prisma.product.findMany({ where: { sellerId: seller.id, moderationStatus: "APPROVED", isPublished: true, promotions: { none: { status: { in: ["PENDING", "ACTIVE"] } } } }, select: { id: true, name: true, thumbnailUrl: true, price: true }, orderBy: { name: "asc" } }), balanceSummary(seller.id)]); return <main className="mx-auto max-w-2xl px-5 py-10 sm:py-20"><div className="mb-8"><Link href="/seller/promotions" className="text-sm font-semibold text-coral">← Kembali ke Promosi</Link><h1 className="display mt-4 text-4xl font-bold sm:text-5xl">Ajukan Promosi</h1><p className="mt-3 text-ink/60">Promosi aktif setelah disetujui admin.</p></div><PromotionForm products={products} available={summary.available} /></main>; }
