import { displayLabel } from "@/lib/display-labels";
import { refundDeadline } from "@/lib/refunds";

type Delivery = {
  id: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  buyerAcceptedAt: Date | null;
  autoAcceptAt: Date | null;
};

type TimelineOrder = {
  createdAt: Date;
  completedAt: Date | null;
  status: string;
  payment: { paidAt: Date | null; status: string } | null;
  deliveries: Delivery[];
  refundRequest?: {
    status: string;
    createdAt: Date;
    refundedAt: Date | null;
  } | null;
};

type Earning = {
  id: string;
  status: string;
  availableAt: Date | null;
  netAmount: number;
};

const formatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});
const currency = new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});

function TimelineRow({ title, date, note, scheduled = false }: {
  title: string;
  date: Date | null;
  note?: string;
  scheduled?: boolean;
}) {
  return <li className="relative border-l-2 border-ink/10 pb-5 pl-5 last:pb-0">
    <span aria-hidden="true" className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${
      !date ? "bg-ink/20" : scheduled ? "bg-coral" : "bg-ink"
    }`} />
    <p className="text-sm font-semibold">{title}</p>
    <p className="mt-1 text-sm text-ink/65">
      {date
        ? <time dateTime={date.toISOString()}>{formatter.format(date)} WIB</time>
        : "Waktu belum tercatat"}
    </p>
    {note && <p className="mt-1 text-xs text-ink/55">{note}</p>}
  </li>;
}

export function OrderTimeline({ order, earnings }: {
  order: TimelineOrder;
  earnings?: Earning[];
}) {
  const now = new Date();
  const closed = ["CANCELLED", "EXPIRED", "REFUNDED"].includes(order.status);
  const pendingNote = closed ? "Tahap tidak dilanjutkan." : "Belum selesai.";
  const deadline = order.completedAt ? refundDeadline(order.completedAt) : null;
  const refund = order.refundRequest;
  const refundNote = refund
    ? "Pengajuan sudah tercatat; ikuti status refund di halaman pesanan."
    : order.status !== "COMPLETED"
      ? "Refund dapat diajukan ketika pesanan berstatus selesai."
      : deadline && now <= deadline
        ? "Batas pengajuan refund: 24 jam sejak pesanan selesai."
        : "Batas pengajuan refund telah lewat.";

  return <section className="mt-6 rounded-2xl bg-white p-5 shadow-soft sm:p-6">
    <h2 className="display text-xl font-bold">Timeline Pesanan</h2>
    <p className="mt-1 text-xs text-ink/55">Semua waktu menggunakan WIB.</p>
    <ol className="mt-5 ml-1">
      <TimelineRow title="Pesanan dibuat" date={order.createdAt} />
      <TimelineRow title="Pembayaran berhasil" date={order.payment?.paidAt ?? null}
        note={!order.payment?.paidAt
          ? order.payment?.status === "PAID"
            ? "Pembayaran terkonfirmasi, tetapi waktunya belum tercatat."
            : pendingNote
          : undefined} />
      {!order.deliveries.length && <TimelineRow
        title="Produk dikirim" date={null} note={pendingNote} />}
      {order.deliveries.map((delivery, index) => {
        const sentAt = delivery.sentAt ?? delivery.deliveredAt;
        const suffix = order.deliveries.length > 1 ? ` — item ${index + 1}` : "";
        return <li key={delivery.id} className="list-none">
          <ol>
            <TimelineRow title={`Produk dikirim${suffix}`} date={sentAt}
              note={!sentAt ? pendingNote : undefined} />
            {delivery.sentAt && <TimelineRow
              title={`Konfirmasi penerimaan${suffix}`}
              date={delivery.buyerAcceptedAt}
              note={!delivery.buyerAcceptedAt
                ? delivery.status === "AWAITING_CONFIRMATION"
                  ? "Menunggu konfirmasi pembeli."
                  : pendingNote
                : "Penerimaan telah tercatat."} />}
            {delivery.status === "AWAITING_CONFIRMATION" && <TimelineRow
              title={`Jadwal selesai otomatis${suffix}`}
              date={delivery.autoAcceptAt}
              scheduled
              note={delivery.autoAcceptAt && delivery.autoAcceptAt <= now
                ? "Jadwal tercapai; menunggu proses konfirmasi otomatis."
                : "Berlaku jika pembeli belum mengonfirmasi penerimaan."} />}
          </ol>
        </li>;
      })}
      <TimelineRow title="Pesanan selesai" date={order.completedAt}
        note={!order.completedAt ? pendingNote : undefined} />
      <TimelineRow title="Batas pengajuan refund" date={deadline}
        scheduled note={refundNote} />
      {refund && <TimelineRow title="Refund diajukan"
        date={refund.createdAt} note={`Status: ${displayLabel(refund.status)}`} />}
      {refund?.refundedAt && <TimelineRow title="Refund selesai"
        date={refund.refundedAt} />}
    </ol>
    {earnings !== undefined && <div className="mt-6 border-t border-ink/10 pt-5">
      <h3 className="text-sm font-bold">Jadwal saldo seller</h3>
      <p className="mt-1 text-xs text-ink/55">
        Waktu berikut adalah jadwal ketersediaan saldo yang tersimpan.
      </p>
      <ol className="mt-4 ml-1">
        {!earnings.length && <TimelineRow title="Pendapatan seller"
          date={null} note="Pendapatan belum tercatat." />}
        {earnings.map((earning) => <TimelineRow key={earning.id}
          title={`Pendapatan ${currency.format(earning.netAmount)}`}
          date={earning.availableAt}
          scheduled={earning.status === "PENDING"}
          note={earning.status === "REVERSED"
            ? "Pendapatan dibatalkan; jadwal ini tidak berlaku."
            : earning.status === "PAID_OUT"
              ? "Pendapatan sudah dibayarkan."
              : earning.status === "AVAILABLE"
                ? "Saldo sudah tersedia."
                : !earning.availableAt
                  ? "Menunggu produk diterima dan jadwal ditetapkan."
                  : earning.availableAt <= now
                    ? "Jadwal tercapai; status saldo masih tertunda."
                    : "Saldo masih tertunda sampai jadwal tersebut."} />)}
      </ol>
    </div>}
  </section>;
}
