import { requireSeller } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { balanceSummary } from "@/lib/seller-finance";
import { WithdrawForm } from "@/components/withdraw-form";
export const dynamic = "force-dynamic";
export default async function SellerWithdrawPage() { const session = await requireSeller(); const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id } }); if (!seller) return null; const [summary, settings] = await Promise.all([balanceSummary(seller.id), prisma.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} })]); return <main className="mx-auto max-w-xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Penarikan</p><h1 className="display mt-3 text-4xl font-bold">Tarik saldo</h1><p className="mt-3 text-ink/60">Saldo tersedia: <strong>{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(summary.available)}</strong>. Minimum: Rp{settings.minimumWithdrawal.toLocaleString("id-ID")}.</p><WithdrawForm available={summary.available} /></main>; }
