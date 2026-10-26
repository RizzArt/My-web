import Link from "next/link";

export const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

export function AdminPageHeader({ eyebrow, title, summary, backHref }: { eyebrow?: string; title: string; summary?: string; backHref?: string }) {
  return <div className="flex flex-wrap items-end justify-between gap-5"><div>{eyebrow && <p className="text-sm font-bold uppercase tracking-[.2em] text-coral">{eyebrow}</p>}<h1 className="display mt-3 text-4xl font-bold sm:text-6xl">{title}</h1>{summary && <p className="mt-4 max-w-2xl text-ink/60">{summary}</p>}</div>{backHref && <Link href={backHref as never} className="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold">Kembali</Link>}</div>;
}

export function AdminStatus({ value }: { value: string }) {
  const tone = ["PAID", "SENT", "DELIVERED", "COMPLETED", "AVAILABLE"].includes(value) ? "bg-mint text-ink" : ["FAILED", "CANCELLED", "EXPIRED"].includes(value) ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{value}</span>;
}

export function AdminEmpty({ message }: { message: string }) { return <p className="py-12 text-center text-sm text-ink/55">{message}</p>; }
