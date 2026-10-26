import Link from "next/link";
import { requireAdmin } from "@/lib/auth-guards";
import { findAdminRefunds, parseAdminRefundStatus } from "@/lib/admin-refunds";
import { currency, dateTime, AdminEmpty, AdminPageHeader, AdminStatus } from "@/components/admin-page";
import { RefundActions } from "@/components/refund-actions";

export const dynamic = "force-dynamic";
const filters = [["ALL", "Semua"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["REFUNDED", "Refunded"], ["REJECTED", "Rejected"]] as const;
export default async function AdminRefundsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const requested = (await searchParams).status;
  const parsedStatus = parseAdminRefundStatus(requested);
  const status = parsedStatus ?? "ALL";
  const rows = await findAdminRefunds(parsedStatus);
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><AdminPageHeader eyebrow="Finance" title="Pengajuan Refund" summary={`${rows.length} pengajuan refund.`} backHref="/admin"/><nav className="mt-8 flex gap-2 overflow-x-auto pb-1" aria-label="Filter refund">{filters.map(([value, label]) => <Link key={value} href={value === "ALL" ? "/admin/refunds" : `/admin/refunds?status=${value}`} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${status === value ? "border-ink bg-ink text-white" : "border-ink/15 bg-white"}`}>{label}</Link>)}</nav><section className="mt-6 overflow-x-auto rounded-2xl bg-white p-5 shadow-soft sm:p-8"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr className="border-b border-ink/10 text-xs uppercase tracking-wider text-ink/50"><th className="p-3">Order</th><th className="p-3">Buyer</th><th className="p-3">Produk</th><th className="p-3">Nominal</th><th className="p-3">Metode</th><th className="p-3">Alasan</th><th className="p-3">Tanggal Pengajuan</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-ink/5 align-top"><td className="p-3"><Link className="font-semibold text-coral" href={`/admin/refunds/${row.id}`}>#{row.order?.orderNumber ?? "-"}</Link></td><td className="p-3">{row.user?.name ?? row.user?.email ?? "-"}</td><td className="p-3">{row.order?.items?.map((item) => item.productName).join(", ") || "-"}</td><td className="p-3 whitespace-nowrap">{currency.format(row.amount)}</td><td className="p-3">{row.method === "ACCOUNT_BALANCE" ? "Saldo Akun" : "Manual Transfer"}</td><td className="max-w-xs p-3">{row.reason || "-"}</td><td className="p-3 whitespace-nowrap">{dateTime.format(row.createdAt)}</td><td className="p-3"><AdminStatus value={row.status}/></td><td className="p-3"><RefundActions id={row.id} status={row.status} method={row.method}/></td></tr>)}</tbody></table>{!rows.length && <AdminEmpty message="Belum ada refund."/>}</section></main>;
}
