import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/profile-form";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const session = await requireUser();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { name: true, email: true, phone: true, emailPreferences: true, createdAt: true, balance: true, walletTransactions: { orderBy: { createdAt: "desc" }, take: 50 } } });
  return <main className="mx-auto max-w-4xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Akun</p><h1 className="display mt-3 text-4xl font-bold sm:text-6xl">Pengaturan akun</h1><p className="mt-4 text-ink/60">Kelola identitas, saldo refund, dan preferensi email kamu.</p><section className="mt-10 rounded-2xl bg-ink p-6 text-white shadow-soft"><p className="text-sm text-white/65">Saldo</p><p className="mt-2 text-3xl font-bold">Rp {user.balance.toLocaleString("id-ID")}</p><h2 className="mt-6 font-bold">Riwayat Saldo</h2><div className="mt-3 space-y-2">{user.walletTransactions.map((transaction) => <div key={transaction.id} className="flex items-center justify-between gap-4 border-t border-white/10 py-3 text-sm"><div><p>{transaction.description}</p><p className="text-xs text-white/55">{transaction.createdAt.toLocaleString("id-ID")}</p></div><div className="text-right"><p className="font-bold text-mint">+Rp {transaction.amount.toLocaleString("id-ID")}</p><p className="text-xs text-white/55">Saldo {transaction.balanceAfter.toLocaleString("id-ID")}</p></div></div>)}{!user.walletTransactions.length && <p className="py-3 text-sm text-white/55">Belum ada transaksi saldo.</p>}</div></section><ProfileForm user={user} joinedAt={user.createdAt.toLocaleDateString("id-ID", { dateStyle: "long" })} /></main>;
}
