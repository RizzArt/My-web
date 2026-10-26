import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { auth } from "@/auth";
import { ReceiptPrintButton } from "@/components/receipt-print-button";
import { displayLabel } from "@/lib/display-labels";
import { formatReceiptCurrency, formatReceiptDate, getPurchaseReceipt } from "@/lib/receipt";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Struk Pembelian",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false, noimageindex: true } },
};

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
}) {
  noStore();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);
  const receipt = await getPurchaseReceipt(orderNumber, { id: session.user.id, role: session.user.role });
  if (!receipt) notFound();
  const autoPrint = query.print === "1";
  const isRefunded = Boolean(receipt.refund);

  return <main className="receipt-page mx-auto max-w-4xl px-4 py-10 sm:px-5 sm:py-16">
    <div className="receipt-actions mb-6 flex flex-wrap items-center justify-between gap-3">
      <a href="/dashboard" className="text-sm font-bold text-coral">← Pesanan Saya</a>
      <ReceiptPrintButton autoPrint={autoPrint} />
    </div>
    <article className="receipt-sheet overflow-hidden rounded-[2rem] bg-white shadow-soft" aria-labelledby="receipt-title">
      <header className="border-b border-ink/10 bg-ink px-6 py-7 text-white sm:px-10 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="display text-3xl font-bold tracking-tight">{SITE_NAME}</p>
            <p className="mt-1 text-sm text-white/70">{receipt.store.name}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-bold uppercase tracking-[.2em] text-mint">Struk Pembelian</p>
            <h1 id="receipt-title" className="mt-2 text-xl font-bold sm:text-2xl">#{receipt.orderNumber}</h1>
          </div>
        </div>
      </header>

      <div className="space-y-8 p-6 sm:p-10">
        {isRefunded && <p role="status" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">DANA DIKEMBALIKAN{receipt.refund?.amount ? ` · ${formatReceiptCurrency(receipt.refund.amount)}` : ""}</p>}
        <section className="grid gap-6 border-b border-ink/10 pb-8 sm:grid-cols-2" aria-label="Informasi transaksi">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink/55">Informasi transaksi</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-ink/60">Tanggal transaksi</dt><dd className="text-right font-semibold">{formatReceiptDate(receipt.paidAt, receipt.store.timezone)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink/60">Status pembayaran</dt><dd className="font-semibold">{displayLabel(receipt.paymentStatus)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink/60">Status pesanan</dt><dd className="font-semibold">{displayLabel(receipt.orderStatus)}</dd></div>
            </dl>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink/55">Pembeli</h2>
            <p className="mt-3 font-semibold">{receipt.buyer.name}</p>
            <p className="mt-1 break-all text-sm text-ink/60">{receipt.buyer.email || "Email tidak tersedia"}</p>
          </div>
        </section>

        <section aria-labelledby="receipt-items-title">
          <h2 id="receipt-items-title" className="display text-2xl font-bold">Detail barang digital</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="receipt-table w-full min-w-[580px] text-left text-sm">
              <thead className="border-y border-ink/10 text-xs uppercase tracking-wider text-ink/55"><tr><th scope="col" className="py-3 pr-4">Produk</th><th scope="col" className="py-3 px-3 text-right">Harga satuan</th><th scope="col" className="py-3 px-3 text-right">Jumlah</th><th scope="col" className="py-3 pl-3 text-right">Subtotal</th></tr></thead>
              <tbody>{receipt.items.map((item, index) => <tr key={`${item.name}-${index}`} className="border-b border-ink/10 align-top"><td className="py-4 pr-4 font-semibold">{item.name}</td><td className="whitespace-nowrap py-4 px-3 text-right">{formatReceiptCurrency(item.unitPrice)}</td><td className="py-4 px-3 text-right">{item.quantity}</td><td className="whitespace-nowrap py-4 pl-3 text-right font-semibold">{formatReceiptCurrency(item.subtotal)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink/60">Produk ini adalah produk digital. Akses atau pengiriman mengikuti status pesanan.</p>
        </section>

        <section className="receipt-summary ml-auto max-w-md rounded-2xl bg-sand p-5" aria-labelledby="receipt-payment-title">
          <h2 id="receipt-payment-title" className="display text-xl font-bold">Ringkasan pembayaran</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt>Subtotal barang</dt><dd className="font-semibold">{formatReceiptCurrency(receipt.subtotal)}</dd></div>
            {receipt.discount > 0 && <div className="flex justify-between gap-4 text-emerald-800"><dt>Diskon / penyesuaian</dt><dd className="font-semibold">−{formatReceiptCurrency(receipt.discount)}</dd></div>}
            {receipt.serviceFee > 0 && <div className="flex justify-between gap-4"><dt>Biaya / penyesuaian</dt><dd className="font-semibold">{formatReceiptCurrency(receipt.serviceFee)}</dd></div>}
            {receipt.tax > 0 && <div className="flex justify-between gap-4"><dt>Pajak</dt><dd className="font-semibold">{formatReceiptCurrency(receipt.tax)}</dd></div>}
            <div className="flex justify-between gap-4 border-t border-ink/15 pt-3 text-base"><dt className="font-bold">Total dibayar</dt><dd className="font-bold">{formatReceiptCurrency(receipt.totalPaid)}</dd></div>
            {receipt.refund && <div className="flex justify-between gap-4 border-t border-ink/15 pt-3 text-red-800"><dt className="font-bold">Total bersih setelah refund</dt><dd className="font-bold">{formatReceiptCurrency(receipt.refund.netPaid)}</dd></div>}
          </dl>
          {receipt.hasLedgerMismatch && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-3 text-xs leading-5 text-amber-900">Ada perbedaan pada catatan total pesanan. Nominal pembayaran yang telah terverifikasi digunakan sebagai nilai otoritatif; hubungi dukungan untuk peninjauan.</p>}
          <div className="mt-5 border-t border-ink/15 pt-4 text-sm"><p>Metode pembayaran: <strong>{receipt.paymentMethod}</strong></p>{receipt.paymentReference && <p className="mt-1 break-all text-ink/60">Referensi pembayaran: <strong className="text-ink">{receipt.paymentReference}</strong></p>}</div>
        </section>

        <footer className="border-t border-ink/10 pt-6 text-sm text-ink/60">
          <p>Dukungan: {receipt.store.supportEmail ?? receipt.store.whatsapp ?? "Hubungi tim dukungan Riezz99"}</p>
          {receipt.store.supportEmail && receipt.store.whatsapp && <p className="mt-1">WhatsApp: {receipt.store.whatsapp}</p>}
          <p className="mt-4">Struk ini diterbitkan secara elektronik dan sah tanpa tanda tangan.</p>
        </footer>
      </div>
    </article>
  </main>;
}
