import Link from "next/link";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AdminEmpty, AdminPageHeader, AdminStatus, currency, dateTime } from "@/components/admin-page";
import { CancellationActions } from "@/components/cancellation-actions";

export const dynamic = "force-dynamic";
const filters = [["ALL", "Semua"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const;

export default async function AdminCancellationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const requested = (await searchParams).status;
  const status = filters.some(([value]) => value === requested) ? requested : "ALL";
  const rows = await prisma.cancellationRequest.findMany({ where: status === "ALL" ? undefined : { status: status as "PENDING" | "APPROVED" | "REJECTED" }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } }, order: { include: { payment: true, items: { select: { productName: true } } } } } });
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><AdminPageHeader eyebrow="Finance" title="Pembatalan Pesanan" summary={`${rows.length} pengajuan pembatalan.`} backHref="/admin"/><nav className="mt-8 flex gap-2 overflow-x-auto pb-1" aria-label="Filter pembatalan">{filters.map(([value, label]) => <Link key={value} href={value === "ALL" ? "/admin/cancellations" : `/admin/cancellations?status=${value}`} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${status === value ? "border-ink bg-ink text-white" : "border-ink/15 bg-white"}`}>{label}</Link>)}</nav><section className="mt-6 overflow-x-auto rounded-2xl bg-white p-5 shadow-soft sm:p-8"><table className="w-full min-w-[1250px] text-left text-sm"><thead><tr className="border-b border-ink/10 text-xs uppercase tracking-wider text-ink/50"><th className="p-3">Order</th><th className="p-3">Buyer</th><th className="p-3">Produk</th><th className="p-3">Total</th><th className="p-3">Metode Pembayaran</th><th className="p-3">Alasan</th><th className="p-3">Tanggal Pengajuan</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-ink/5 align-top"><td className="p-3"><Link className="font-semibold text-coral" href={`/admin/orders/${row.orderId}`}>#{row.order.orderNumber}</Link></td><td className="p-3">{row.user.name || row.user.email}</td><td className="p-3">{row.order.items.map((item) => item.productName).join(", ")}</td><td className="whitespace-nowrap p-3">{currency.format(row.amount)}</td><td className="p-3">{row.order.payment?.provider || "-"}</td><td className="max-w-xs p-3">{row.reason}</td><td className="whitespace-nowrap p-3">{dateTime.format(row.createdAt)}</td><td className="p-3"><AdminStatus value={row.status}/></td><td className="p-3"><CancellationActions id={row.id} status={row.status}/></td></tr>)}</tbody></table>{!rows.length && <AdminEmpty message="Belum ada pengajuan pembatalan."/>}</section></main>;
}
