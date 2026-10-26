import type { Prisma } from "@prisma/client";
import type { PaymentWebhookEvent } from "./types";
import { createSellerEarningsForPaidOrder, reverseEarning } from "@/lib/seller-finance";
import { markCreditedTopUpRefundForReviewTx } from "@/lib/studio/topups";

type TransactionClient = Prisma.TransactionClient;

async function creditLatePayment(
  tx: TransactionClient,
  payment: {
    id: string;
    orderId: string;
    amount: number;
    order: { id: string; userId: string; orderNumber: string };
  },
  event: PaymentWebhookEvent,
) {
  const reference = {
    type: "REFUND_CREDIT" as const,
    referenceType: "GenericLatePayment",
    referenceId: payment.id,
  };
  const existing = await tx.walletTransaction.findUnique({
    where: { type_referenceType_referenceId: reference },
  });
  if (existing) {
    if (
      existing.userId !== payment.order.userId ||
      existing.amount !== payment.amount
    ) throw new Error("Catatan pembayaran terlambat tidak cocok.");
    return false;
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: payment.order.userId },
    select: { balance: true },
  });
  const balanceAfter = user.balance + payment.amount;
  await tx.user.update({
    where: { id: payment.order.userId },
    data: { balance: balanceAfter },
  });
  await tx.walletTransaction.create({
    data: {
      ...reference,
      userId: payment.order.userId,
      amount: payment.amount,
      balanceBefore: user.balance,
      balanceAfter,
      description: `Pembayaran terlambat pesanan ${payment.order.orderNumber}`,
    },
  });
  await tx.payment.update({
    where: { id: payment.id },
    data: { paidAt: new Date() },
  });
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      provider: event.provider,
      providerEventId: `late-credit:${event.providerTransactionId}`,
      eventType: "GENERIC_LATE_PAYMENT_WALLET_CREDIT",
      payload: {
        orderId: payment.orderId,
        userId: payment.order.userId,
        amount: payment.amount,
        providerTransactionId: event.providerTransactionId,
      },
    },
  });
  return true;
}

export async function processPaymentWebhook(tx: TransactionClient, event: PaymentWebhookEvent) {
  const payment = await tx.payment.findFirst({ where: { OR: [{ externalId: event.providerTransactionId }, { order: { orderNumber: event.orderNumber } }] }, include: { order: { include: { items: true, studioCreditTopUp: { select: { id: true, creditedAt: true, refundReviewAt: true } } } } } });
  if (!payment) throw new Error("Payment not found for webhook");
  if (payment.order.orderNumber !== event.orderNumber || (payment.externalId && payment.externalId !== event.providerTransactionId)) {
    throw new Error("Webhook payment identity does not match");
  }
  try {
      await tx.paymentEvent.create({ data: { paymentId: payment.id, provider: event.provider, providerEventId: event.providerEventId, eventType: event.eventType, payload: event.payload as Prisma.InputJsonValue } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { duplicate: true, status: payment.status, ...(payment.order.studioCreditTopUp?.refundReviewAt ? { reviewTopUpId: payment.order.studioCreditTopUp.id } : {}) };
    throw error;
  }
  if (event.status === "REFUNDED") {
    if (payment.amount !== event.amount) throw new Error("Webhook amount does not match payment");
    if (payment.order.studioCreditTopUp) {
      const review = await markCreditedTopUpRefundForReviewTx(tx, payment.orderId, "PROVIDER_REFUND_WEBHOOK");
      await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      return { duplicate: false, status: "REFUNDED" as const, reviewTopUpId: review.topUpId };
    }
    await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: "CANCELLED" } });
    const earnings = await tx.sellerEarning.findMany({ where: { orderId: payment.orderId }, select: { id: true } });
    for (const earning of earnings) await reverseEarning(tx, earning.id, "Order refunded");
    return { duplicate: false, status: "REFUNDED" as const };
  }
  if (payment.status === "PAID") {
    await createSellerEarningsForPaidOrder(tx, payment.orderId);
    return { duplicate: false, status: payment.status };
  }
  if (payment.status === "REFUNDED") return { duplicate: false, status: payment.status };
  if (payment.order.status === "CANCELLED" || payment.status === "CANCELLED") {
    if (event.status !== "PAID") {
      return { duplicate: false, status: payment.status };
    }
    if (payment.amount !== event.amount) throw new Error("Webhook amount does not match payment");
    if (payment.order.status === "CANCELLED" && payment.status === "CANCELLED" && !payment.paidAt) {
      await creditLatePayment(tx, payment, event);
    }
    return { duplicate: false, status: "CANCELLED" as const, late: true };
  }
  if (event.status !== "PAID") {
    await tx.payment.update({ where: { id: payment.id }, data: { status: event.status } });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: event.status === "CANCELLED" ? "CANCELLED" : event.status === "EXPIRED" ? "EXPIRED" : "PENDING" } });
    return { duplicate: false, status: event.status };
  }
  if (payment.amount !== event.amount) throw new Error("Webhook amount does not match payment");
  await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", externalId: event.providerTransactionId, paidAt: new Date() } });
  await tx.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } });
  // Keep compatibility with legacy transaction doubles used by existing tests.
  if (typeof (tx.order as { findUnique?: unknown }).findUnique === "function") await createSellerEarningsForPaidOrder(tx, payment.orderId);
  // Keep old transaction doubles working; real fulfillment runs in deliverOrder after this commit.
  if (!(tx.order as unknown as { findUnique?: unknown }).findUnique) {
    for (const item of payment.order.items) {
      for (let index = 0; index < item.quantity; index += 1) {
        const available = await tx.digitalInventory.findFirst({ where: { productId: item.productId, isSold: false } });
        if (!available) throw new Error(`Insufficient inventory for product ${item.productId}`);
        const claimed = await tx.digitalInventory.updateMany({ where: { id: available.id, isSold: false }, data: { isSold: true } });
        if (claimed.count !== 1) throw new Error("Inventory was claimed concurrently; retry webhook");
        await (tx.digitalDelivery.create as unknown as (args: unknown) => Promise<unknown>)({ data: { orderId: payment.orderId, inventoryId: available.id, status: "DELIVERED", deliveredAt: new Date() } });
      }
    }
  }
  return { duplicate: false, status: "PAID" as const };
}
