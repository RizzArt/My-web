import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentProvider } from "@/lib/payments/midtrans";
import { processPaymentWebhook } from "@/lib/payments/fulfillment";
import { fulfillPaidOrder } from "@/lib/payments/paid-order-fulfillment";
import { notifyAdmins } from "@/lib/admin-notifications";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const event = paymentProvider.handleWebhook(rawBody, request.headers.get("x-midtrans-signature"));
    const target = await prisma.payment.findFirst({
      where: { order: { is: { orderNumber: event.orderNumber } } },
      select: { provider: true },
    });
    if (target?.provider === "SOCIABUZZ" || target?.provider === "WALLET") {
      throw new Error("Webhook provider does not match this payment.");
    }
    let result: Awaited<ReturnType<typeof processPaymentWebhook>> | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { result = await prisma.$transaction((tx) => processPaymentWebhook(tx, event), { isolationLevel: "Serializable" }); break; } catch (error) { if ((error as { code?: string }).code !== "P2034" || attempt === 3) throw error; }
    }
    if (!result) throw new Error("Payment transaction did not complete");
    if ("reviewTopUpId" in result && result.reviewTopUpId) {
      try {
        await notifyAdmins({ eventKey: `studio-topup-refund-review:${result.reviewTopUpId}`, title: "Refund Top Up Studio Credit Perlu Review", message: "Top up Studio Credit yang sudah dikreditkan memerlukan peninjauan manual.", link: "/admin/refunds" });
      } catch (error) {
        // The financial transaction is already committed; acknowledge it and let a duplicate callback retry notification.
        console.error("Studio top-up refund review notification failed", { category: error instanceof Error ? error.name : "unknown", topUpId: result.reviewTopUpId });
      }
    }
    if (result.status === "PAID") {
      const paidOrder = await prisma.order.findUnique({ where: { orderNumber: event.orderNumber } });
      if (paidOrder) await fulfillPaidOrder(paidOrder.id);
    }
    return NextResponse.json({ received: true, duplicate: result.duplicate, status: result.status });
  } catch (error) {
    console.error("Payment webhook rejected", { category: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
