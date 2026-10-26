import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/secrets";
import { WithdrawalActions } from "@/components/withdrawal-actions";
export const dynamic = "force-dynamic";
export default async function AdminWithdrawalDetail({ params }: { params: Promise<{ withdrawalId: string }> }) { await requireAdmin(); const { withdrawalId } = await params; const row = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, include: { seller: { include: { user: true } } } }); if (!row) notFound(); return <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20"><h1 className="display text-4xl font-bold">Withdrawal detail</h1><div className="mt-8 space-y-3 rounded-2xl bg-white p-6 shadow-soft"><p>Seller: <strong>{row.seller.storeName}</strong></p><p>Amount: <strong>Rp{row.amount.toLocaleString("id-ID")}</strong></p><p>Method: {row.method}</p><p>Account name: {row.accountName}</p><p>Destination: <strong>{decryptSecret(row.accountNumberEncrypted)}</strong></p><p>Status: <strong>{row.status}</strong></p>{row.sellerNote && <p>Catatan seller: {row.sellerNote}</p>}<WithdrawalActions id={row.id} status={row.status} /></div></main>; }
