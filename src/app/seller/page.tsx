import { displayLabel } from "@/lib/display-labels";
import Link from "next/link";
import { requireSellerOrAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { balanceSummary, financeAggregate, formatFinanceDate, recentSellerFinance } from "@/lib/seller-finance";
import { currency } from "@/components/admin-page";

export const dynamic = "force-dynamic";
const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

export default async function SellerDashboard() {
  const session = await requireSellerOrAdmin();
  if (session.user.role === "ADMIN") return <main className="mx-auto max-w-5xl px-5 py-20"><h1 className="display text-5xl font-bold">Area penjual</h1><p className="mt-4">Admin dapat mengelola semua seller melalui menu admin.</p></main>;
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id }, include: { _count: { select: { products: true } } } });
  if (!seller) return null;
  const [active, inactive, recent, finance, thirtyDays, balance, transactions, settings] = await Promise.all([
    prisma.product.count({ where: { sellerId: seller.id, isPublished: true, moderationStatus: "APPROVED" } }),
    prisma.product.count({ where: { sellerId: seller.id, isPublished: false } }),
    prisma.product.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    financeAggregate(seller.id, "all"), financeAggregate(seller.id, "30d"), balanceSummary(seller.id), recentSellerFinance(seller.id), prisma.storeSetting.findUnique({ where: { id: "default" }, select: { timezone: true } }),
  ]);
  const cards = [["Saldo tersedia", balance.available], ["Saldo tertunda", balance.pending], ["Total penghasilan", balance.totalEarnings], ["Penjualan kotor", finance.grossSales], ["Biaya platform", finance.platformFee], ["Sedang ditarik", balance.withdrawing]] as const;
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Dasbor Penjual</p><h1 className="display mt-3 text-5xl font-bold">{seller.storeName}</h1>
    <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-2xl bg-white p-5 shadow-soft"><p className="text-sm text-ink/55">{label}</p><p className="mt-2 text-2xl font-bold leading-tight">{currency.format(value)}</p></div>)}</section>{balance.nextPendingAvailableAt && <p className="mt-4 rounded-xl bg-sand p-4 text-sm text-ink/70">Saldo tertunda tersedia setelah {formatFinanceDate(balance.nextPendingAvailableAt, settings?.timezone ?? "Asia/Jakarta")}.</p>}
    <section className="mt-8 rounded-2xl bg-sand p-6 shadow-soft sm:p-8"><p className="text-sm font-bold uppercase tracking-[.16em] text-coral">Penjualan 30 Hari</p><p className="display mt-2 text-4xl font-bold">{currency.format(thirtyDays.grossSales)}</p><div className="mt-5 grid gap-4 sm:grid-cols-3"><div><p className="text-sm text-ink/55">Biaya platform</p><p className="font-bold">{currency.format(thirtyDays.platformFee)}</p></div><div><p className="text-sm text-ink/55">Pendapatan bersih</p><p className="font-bold">{currency.format(thirtyDays.sellerEarnings)}</p></div><div><p className="text-sm text-ink/55">Penarikan</p><p className="font-bold">{currency.format(thirtyDays.pendingWithdrawals + thirtyDays.paidWithdrawals)}</p></div></div></section>
    <div className="mt-8 flex flex-wrap gap-3"><Link href="/seller/wallet" className="rounded-full bg-ink px-5 py-3 font-bold text-white">Lihat saldo</Link><Link href="/seller/withdraw" className="rounded-full bg-coral px-5 py-3 font-bold text-white">Tarik Saldo</Link><Link href="/seller/products/new" className="rounded-full border border-ink/20 px-5 py-3 font-bold">Tambah produk</Link><Link href="/seller/products" className="rounded-full border border-ink/20 px-5 py-3 font-bold">Kelola produk</Link></div>
    <section className="mt-10 rounded-2xl bg-white p-6 shadow-soft"><h2 className="display text-2xl font-bold">5 transaksi saldo terbaru</h2><div className="mt-4 divide-y divide-ink/10">{transactions.map((transaction) => <div key={transaction.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-semibold">{transaction.description}</p><p className="text-xs text-ink/50">{dateTime.format(transaction.createdAt)} · {displayLabel(transaction.type)}</p></div><p className={transaction.amount < 0 ? "font-bold text-red-700" : "font-bold"}>{currency.format(transaction.amount)}</p></div>)}</div>{!transactions.length && <p className="py-8 text-center text-sm text-ink/55">Belum ada transaksi saldo. Saldo akan tampil di sini setelah ada penjualan.</p>}</section>
    <section className="mt-10 grid gap-4 sm:grid-cols-3">{[["Produk aktif", active], ["Produk nonaktif", inactive], ["Total produk", seller._count.products]].map(([label, value]) => <div key={label} className="rounded-2xl bg-white p-6 shadow-soft"><p className="text-sm text-ink/55">{label}</p><p className="display mt-2 text-4xl font-bold">{value}</p></div>)}</section>
    <section className="mt-10 rounded-2xl bg-white p-6 shadow-soft"><h2 className="display text-2xl font-bold">Produk terbaru</h2><div className="mt-4 space-y-3">{recent.map((product) => <div key={product.id} className="flex flex-wrap justify-between border-b border-ink/10 py-3"><span>{product.name}</span><span className="text-xs text-coral">{displayLabel(product.moderationStatus)}</span></div>)}</div>{!recent.length && <p className="py-8 text-center text-sm text-ink/55">Belum ada produk.</p>}</section>
  </main>;
}
