import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AccountStatusAction } from "@/components/account-status-action";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
});

export default async function AccountsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const query = await searchParams;
  const value = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const q = value("q").trim().slice(0, 120);
  const role = ["CUSTOMER", "SELLER"].includes(value("role")) ? value("role") : "";
  const status = ["active", "banned"].includes(value("status")) ? value("status") : "";
  const requested = /^\d+$/.test(value("page")) ? Number(value("page")) : 1;

  const where: Prisma.UserWhereInput = {
    role: role === "CUSTOMER" ? "CUSTOMER" : role === "SELLER" ? "SELLER" : { in: ["CUSTOMER", "SELLER"] },
    ...(status ? { isActive: status === "active" } : {}),
    ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { sellerProfile: { is: { storeName: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
  const count = await prisma.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(requested) ? requested : 1));
  const users = await prisma.user.findMany({
    where, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
      sellerProfile: { select: { storeName: true } },
    },
  });
  const href = (next: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    params.set("page", String(next));
    return `/admin/accounts?${params.toString()}`;
  };

  return <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
    <Link href="/admin" className="text-sm font-bold text-coral">← Admin Dashboard</Link>
    <h1 className="display mt-5 text-3xl font-bold sm:text-5xl">Kelola Akun</h1>
    <p className="mt-3 text-sm text-ink/60">Kelola akses buyer dan seller. Tindakan ban dicatat di Audit Logs.</p>
    <form method="get" className="mt-6 grid gap-3 rounded-2xl bg-white p-4 shadow-soft sm:grid-cols-4">
      <label className="grid gap-1 text-sm">Cari akun
        <input name="q" defaultValue={q} maxLength={120} placeholder="Nama, email, toko"
          className="min-w-0 rounded-xl border border-ink/15 px-3 py-3" />
      </label>
      <label className="grid gap-1 text-sm">Jenis akun
        <select name="role" defaultValue={role} className="rounded-xl border border-ink/15 px-3 py-3">
          <option value="">Semua</option><option value="CUSTOMER">Buyer</option><option value="SELLER">Seller</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">Status
        <select name="status" defaultValue={status} className="rounded-xl border border-ink/15 px-3 py-3">
          <option value="">Semua</option><option value="active">Aktif</option><option value="banned">Banned</option>
        </select>
      </label>
      <button className="self-end rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white">Cari</button>
    </form>
    <p className="mt-5 text-sm text-ink/60">{count} akun ditemukan.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {users.map((user) => <article key={user.id} className="min-w-0 rounded-2xl bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words font-bold">{user.name ?? "Tanpa nama"}</h2>
            <p className="mt-1 break-all text-sm text-ink/60">{user.email}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${user.isActive ? "bg-mint" : "bg-red-100 text-red-800"}`}>
            {user.isActive ? "Aktif" : "Banned"}
          </span>
        </div>
        <p className="mt-3 text-sm">{user.role === "SELLER" ? "Seller" : "Buyer"}{user.sellerProfile ? ` · ${user.sellerProfile.storeName}` : ""}</p>
        <p className="mt-1 text-xs text-ink/55">Bergabung {dateTime.format(user.createdAt)} WIB</p>
        <AccountStatusAction key={`${user.id}:${user.isActive}`} userId={user.id}
          label={user.name ?? user.email} isActive={user.isActive} />
      </article>)}
    </div>
    {!users.length && <p className="mt-5 rounded-2xl bg-white p-8 text-center text-sm">Tidak ada akun yang cocok.</p>}
    {totalPages > 1 && <nav aria-label="Halaman akun" className="mt-6 flex flex-wrap items-center justify-center gap-4">
      {page > 1 && <Link href={href(page - 1) as never} className="rounded-full border border-ink/20 px-4 py-3 text-sm">Sebelumnya</Link>}
      <span className="text-sm">{page} / {totalPages}</span>
      {page < totalPages && <Link href={href(page + 1) as never} className="rounded-full bg-ink px-4 py-3 text-sm text-white">Selanjutnya</Link>}
    </nav>}
  </main>;
}
