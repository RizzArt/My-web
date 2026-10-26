import { displayLabel } from "@/lib/display-labels";
import { requireSeller } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { currency } from "@/components/admin-page";
import { acceptDueManualDeliveries } from "@/lib/delivery/service";
import { formatFinanceDate } from "@/lib/seller-finance";
import { ManualDeliveryForm } from "@/components/manual-delivery-form";
import { OrderTimeline } from "@/components/order-timeline";

export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
  const session = await requireSeller();
  await acceptDueManualDeliveries();
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id } });
  const orders = seller ? await prisma.order.findMany({
    where: { items: { some: { product: { sellerId: seller.id } } } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      completedAt: true,
      payment: { select: { paidAt: true, status: true } },
      refundRequest: { select: { status: true, createdAt: true, refundedAt: true } },
      earnings: {
        where: { sellerId: seller.id },
        select: { id: true, status: true, availableAt: true, netAmount: true },
      },
      items: {
        where: { product: { sellerId: seller.id } },
        select: {
          id: true,
          productName: true,
          unitPrice: true,
          quantity: true,
          deliveries: {
            select: { id: true, status: true, sentAt: true, deliveredAt: true, buyerAcceptedAt: true, autoAcceptAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  return <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20">
    <p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Area penjual</p>
    <h1 className="display mt-3 text-5xl font-bold">Pesanan toko</h1>
    <section className="mt-10 space-y-3">
      {orders.map((order) => {
        const deliveries = order.items.flatMap((item) => item.deliveries);
        return <article key={order.id} className="rounded-2xl bg-white p-6 shadow-soft">
          <div className="flex flex-wrap justify-between gap-3">
            <strong>#{order.orderNumber}</strong>
            <span>{displayLabel(order.status)}</span>
          </div>
          <p className="mt-2 text-sm text-ink/60">
            {order.items.map((item) => `${item.productName} x${item.quantity}`).join(", ")}
            {" "}· {currency.format(order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))}
          </p>
          <OrderTimeline order={{ ...order, deliveries }} earnings={order.earnings} />
          {deliveries.filter((delivery) => delivery.status === "WAITING_MANUAL_DELIVERY").map((delivery) =>
            <ManualDeliveryForm key={delivery.id} orderId={order.id} deliveryId={delivery.id} />,
          )}
          {deliveries.filter((delivery) => delivery.status === "AWAITING_CONFIRMATION").map((delivery) =>
            <p key={delivery.id} className="mt-4 rounded-xl bg-coral/10 p-4 text-sm font-semibold">
              Menunggu konfirmasi pembeli. Otomatis selesai pada {formatFinanceDate(delivery.autoAcceptAt, "Asia/Jakarta")} WIB
            </p>,
          )}
        </article>;
      })}
      {!orders.length && <p className="rounded-2xl bg-white p-8 text-center text-sm text-ink/60">Belum ada order untuk produkmu.</p>}
    </section>
  </main>;
}
