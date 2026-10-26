import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SellerApplicationForm } from "@/components/seller-application-form";

export const dynamic = "force-dynamic";
export default async function BecomeSellerPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "SELLER") redirect("/seller");
  if (session.user.role === "ADMIN") redirect("/admin");
  const applications = await prisma.sellerApplication.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 5 });
  return <main className="mx-auto max-w-3xl px-5 py-12 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Seller program</p><h1 className="display mt-3 text-4xl font-bold sm:text-6xl">Become a Seller</h1><p className="mt-4 text-ink/60">Ajukan toko digitalmu. Tim kami akan meninjau sebelum produk ditayangkan.</p><SellerApplicationForm user={{ email: session.user.email ?? "", name: session.user.name ?? "" }} /><section className="mt-10 rounded-2xl bg-white p-6 shadow-soft"><h2 className="display text-2xl font-bold">Application status</h2>{applications.length ? <div className="mt-5 space-y-3">{applications.map((item) => <article key={item.id} className="rounded-xl bg-sand p-4"><div className="flex justify-between gap-3"><strong>{item.storeName}</strong><span className="text-xs font-bold uppercase text-coral">{item.status}</span></div>{item.rejectionReason && <p className="mt-2 text-sm text-red-700">Alasan: {item.rejectionReason}</p>}</article>)}</div> : <p className="mt-3 text-sm text-ink/60">Belum ada pengajuan.</p>}</section></main>;
}
