import { IpaymuPayment } from "@/components/ipaymu-payment";
import { hasIpaymuWalletLock } from "@/lib/payments/ipaymu-guard";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { WalletPaymentButton } from "@/components/wallet-payment-button";
import { SociaBuzzPayment } from "@/components/sociabuzz-payment";
import { createDynamicQris, qrisStaticPayload } from "@/lib/payments/qris";
import { hasActiveSociaBuzzInvoice } from "@/lib/payments/sociabuzz-guard";
import { hasActivePayPalCheckout } from "@/lib/payments/paypal";
import { PayPalPayment } from "@/components/paypal-payment";
import { getUnpaidOrderDeadline, isUnpaidOrderExpired } from "@/lib/order-expiry";
import { assertPayPalEligibleOrderItems } from "@/lib/payments/paypal-eligibility";
import { ReceiptLinks } from "@/components/receipt-links";
import { canViewReceipt } from "@/lib/receipt";

export const dynamic = "force-dynamic";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { orderNumber } = await params;
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId: session.user.id },
    include: { payment: true, refundRequest: { select: { status: true } }, studioCreditTopUp: { select: { packageName: true, credits: true } }, user: { select: { balance: true } }, items: { include: { product: { select: { sellerId: true } } } } },
  });
  if (!order?.payment) redirect("/dashboard");

  const paid = order.payment.status === "PAID";
  const receiptAvailable = canViewReceipt(order.payment.status, order.status, order.refundRequest?.status);
  const cancelled = order.payment.status === "CANCELLED" || order.status === "CANCELLED";
  const pending = !paid && !cancelled && order.payment.status === "PENDING" && order.status === "PENDING";
  const expiredByTimeout = pending && isUnpaidOrderExpired(order.createdAt);
  const paymentOpen = pending && !expiredByTimeout;
  const deadlineAt = getUnpaidOrderDeadline(order.createdAt).getTime();
  const locked = hasActiveSociaBuzzInvoice(order.payment) || hasIpaymuWalletLock(order.payment) || hasActivePayPalCheckout(order.payment);
  const remaining = order.user.balance - order.total;
  let qrisImageDataUrl: string | null = null;
  let qrisGenerationFailed = false;
  let paypalEligible = false;

  if (paymentOpen && order.payment.provider === "PAYPAL") {
    try { await assertPayPalEligibleOrderItems(order.items); paypalEligible = true; } catch { paypalEligible = false; }
  }

  if (paymentOpen && order.payment.provider === "QRIS_MANUAL") {
    try {
      const staticPayload = qrisStaticPayload();
      if (!staticPayload) throw new Error("QRIS belum tersedia.");
      const dynamicPayload = createDynamicQris(staticPayload, order.total);
      qrisImageDataUrl = await QRCode.toDataURL(dynamicPayload,
        { errorCorrectionLevel: "M", margin: 2, width: 280 },
      );
    } catch {
      qrisGenerationFailed = true;
      console.error("QRIS generation failed", { orderNumber });
    }
  }

  return <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
    <p className="text-sm font-bold uppercase tracking-[.2em] text-coral">Payment</p>
    <h1 className="display mt-3 text-4xl font-bold sm:text-5xl">{order.studioCreditTopUp ? `Top Up ${order.studioCreditTopUp.packageName}` : `Pesanan ${orderNumber}`}</h1>
    <div className="mt-8 rounded-[2rem] bg-white p-5 shadow-soft sm:p-8">
      <div className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold ${paid ? "bg-mint" : "bg-sand"}`}>
        {paid ? "PAID" : cancelled ? "Dibatalkan" : pending ? "Menunggu Pembayaran" : order.payment.status}
      </div>
      <p className="mt-6 text-ink/65">Total pesanan: <strong>Rp {order.total.toLocaleString("id-ID")}</strong></p>
      {paid && order.studioCreditTopUp && <p className="mt-5 rounded-xl bg-mint p-4 text-sm font-semibold">{order.studioCreditTopUp.credits} Studio Credit telah ditambahkan ke akun Anda.</p>}
      {order.payment.provider === "IPAYMU" && <IpaymuPayment orderId={order.id} />}
      {pending && <>
        {expiredByTimeout && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">Batas pembayaran 10 menit sejak pesanan dibuat sudah lewat. Pembayaran baru dan pembuatan QR dinonaktifkan; pesanan akan dibatalkan otomatis oleh sistem.</p>}
        {order.payment.provider === "SOCIABUZZ" && <SociaBuzzPayment
          orderId={order.id}
          locked={locked}
          amount={order.total}
          deadlineAt={deadlineAt}
        />}
        {paymentOpen && order.payment.provider === "PAYPAL" && (paypalEligible
          ? <PayPalPayment orderId={order.id} />
          : <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">PayPal tidak tersedia untuk item pada pesanan ini.</p>)}
        {paymentOpen && order.payment.provider === "QRIS_MANUAL" && <section className="mt-8 border-t border-ink/10 pt-6">
          <h2 className="text-xl font-bold">Bayar dengan QRIS</h2>
          {qrisImageDataUrl ? <div className="mt-4 rounded-2xl bg-sand p-4 text-center">
            <img src={qrisImageDataUrl} alt="QRIS pembayaran" className="mx-auto h-auto w-full max-w-[280px] rounded-xl bg-white" />
            <p className="mt-4 text-2xl font-bold">Rp {order.total.toLocaleString("id-ID")}</p>
            <p className="mt-3 text-sm">Setelah pembayaran berhasil, tunggu verifikasi admin.</p>
          </div> : qrisGenerationFailed && <p className="mt-4 text-sm">QRIS sementara tidak dapat ditampilkan.</p>}
        </section>}
        {!locked && !expiredByTimeout ? <section className="mt-8 border-t border-ink/10 pt-6">
          <h2 className="text-xl font-bold">Bayar dengan Saldo Akun</h2>
          <div className="mt-3 grid gap-2 rounded-xl bg-sand p-4 text-sm">
            <p>Saldo saat ini: <strong>Rp {order.user.balance.toLocaleString("id-ID")}</strong></p>
            <p>Total pesanan: <strong>Rp {order.total.toLocaleString("id-ID")}</strong></p>
            <p>Sisa saldo setelah pembayaran: <strong className={remaining < 0 ? "text-red-700" : "text-emerald-700"}>Rp {remaining.toLocaleString("id-ID")}</strong></p>
          </div>
          <WalletPaymentButton orderId={order.id} amount={order.total} balance={order.user.balance} />
        </section> : <p className="mt-6 rounded-xl bg-sand p-4 text-sm">
          {expiredByTimeout ? "Batas pembayaran 10 menit sudah lewat. Menunggu pembatalan otomatis." : "Invoice pembayaran sedang diproses. Pilihan Saldo Akun dikunci untuk mencegah pembayaran ganda."}
        </p>}
      </>}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {receiptAvailable && <ReceiptLinks orderNumber={order.orderNumber} />}
        {paid && order.studioCreditTopUp && <Link href="/studio" className="inline-block font-semibold text-coral">Kembali ke AI Studio →</Link>}
        <Link href={`/dashboard/orders/${order.id}`} className="inline-block font-semibold text-coral">Lihat detail pesanan →</Link>
      </div>
    </div>
  </main>;
}
