import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AdminEmpty, AdminPageHeader, dateTime } from "@/components/admin-page";
import { BroadcastForm } from "@/components/broadcast-form";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  await requireAdmin();
  const broadcasts = await prisma.broadcast.findMany({ include: { createdBy: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><AdminPageHeader eyebrow="Communication" title="Broadcast" summary="Kirim notifikasi in-app ke customer atau seller. Email massal tidak dikirim." backHref="/admin" /><BroadcastForm /><section className="mt-10 overflow-hidden rounded-2xl bg-white p-5 shadow-soft sm:p-8"><h2 className="display text-2xl font-bold">Broadcast history</h2><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-ink/10 text-xs uppercase tracking-wider text-ink/50"><th className="px-3 py-3">Title</th><th className="px-3 py-3">Target</th><th className="px-3 py-3">Recipients</th><th className="px-3 py-3">Admin</th><th className="px-3 py-3">Created</th></tr></thead><tbody>{broadcasts.map((broadcast) => <tr key={broadcast.id} className="border-b border-ink/5 last:border-0"><td className="px-3 py-4 font-semibold">{broadcast.title}</td><td className="px-3 py-4">{broadcast.targetAudience}</td><td className="px-3 py-4">{broadcast.recipientCount}</td><td className="px-3 py-4">{broadcast.createdBy.name ?? broadcast.createdBy.email}</td><td className="whitespace-nowrap px-3 py-4 text-ink/60">{dateTime.format(broadcast.createdAt)}</td></tr>)}</tbody></table></div>{!broadcasts.length && <AdminEmpty message="Belum ada broadcast." />}</section></main>;
}
