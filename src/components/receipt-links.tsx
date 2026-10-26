export function ReceiptLinks({ orderNumber }: { orderNumber: string }) {
  const receiptUrl = `/orders/${encodeURIComponent(orderNumber)}/receipt`;
  return <div className="receipt-actions flex flex-wrap gap-2">
    <a href={receiptUrl} className="rounded-full border border-ink/20 px-5 py-2.5 text-sm font-bold hover:border-coral hover:text-coral">Lihat Struk</a>
    <a href={`${receiptUrl}?print=1`} className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white hover:bg-coral">Cetak / Simpan PDF</a>
  </div>;
}
