import Link from "next/link";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { decryptSecret, maskPayoutDestination } from "@/lib/security/secrets";
import { CustomerWithdrawalActions } from "@/components/customer-withdrawal-actions";

export const dynamic = "force-dynamic";
const filters = [["ALL", "Semua"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["PAID", "Paid"]] as const;

export default async function AdminCustomerWithdrawalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const requested = (await searchParams).status;
  const status = filters.some(([value]) => value === requested) ? requested : "ALL";
  const rows = await prisma.customerWithdrawal.findMany({ where: status === "ALL" ? undefined : { status: status as "PENDING" | "APPROVED" | "REJECTED" | "PAID" }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" } });
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Back office</p><h1 className="display mt-3 text-5xl font-bold">Penarikan Saldo Buyer</h1><nav className="mt-8 flex gap-2 overflow-x-auto pb-1" aria-label="Filter penarikan buyer">{filters.map(([value, label]) => <Link key={value} href={value === "ALL" ? "/admin/customer-withdrawals" : `/admin/customer-withdrawals?status=${value}`} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${status === value ? "border-ink bg-ink text-white" : "border-ink/15 bg-white"}`}>{label}</Link>)}</nav><div className="mt-6 overflow-x-auto rounded-2xl bg-white p-5 shadow-soft"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-ink/10 text-xs uppercase text-ink/50"><th className="p-3">Buyer</th><th className="p-3">Nominal</th><th className="p-3">Tujuan</th><th className="p-3">Tanggal</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-ink/5"><td className="p-3">{row.user.name || row.user.email}</td><td className="p-3">Rp {row.amount.toLocaleString("id-ID")}</td><td className="p-3">{row.payoutType} · {row.payoutProvider} · {maskPayoutDestination(decryptSecret(row.payoutAccountNumberEncrypted))}</td><td className="p-3">{row.createdAt.toLocaleString("id-ID")}</td><td className="p-3 font-semibold">{row.status}</td><td className="p-3"><CustomerWithdrawalActions id={row.id} status={row.status} /></td></tr>)}</tbody></table>{!rows.length && <p className="py-12 text-center text-sm text-ink/55">Belum ada penarikan buyer.</p>}</div></main>;
}
