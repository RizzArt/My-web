import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "./paid-order-fulfillment";
import { createSellerEarningsForPaidOrder } from "@/lib/seller-finance";
import { notifyAdmins } from "@/lib/admin-notifications";
import { getUnpaidOrderDeadline, isUnpaidOrderExpired } from "@/lib/order-expiry";
import { autoCancelExpiredOrder } from "@/lib/customer-cancellation";
import { assertPayPalSandboxStorage, capturePayPalOrder, createPayPalOrder, getPayPalOrder, paypalConfig, usdAmountForIdr } from "./paypal";
import { paypalCaptureNeedsReview, validatePayPalCapture, type PayPalCaptureEvidence } from "./paypal-validation";
import { assertPayPalEligibleOrderItems, type PayPalOrderItem } from "./paypal-eligibility";

type CheckoutOrder = {
  id: string; userId: string; orderNumber: string; total: number; status: string; createdAt: Date;
  payment: { id: string; provider: string | null; status: string; externalId: string | null; amount: number; paypalCheckout: { paypalOrderId: string | null; amount: string; idrToUsdRate: string; expectedMerchantId: string; expiresAt: Date } | null } | null;
  items: PayPalOrderItem[];
};

function assertOwnedPending(order: CheckoutOrder | null, userId?: string) {
  if (!order || !order.payment || order.payment.provider !== "PAYPAL" || (userId && order.userId !== userId)) throw new Error("Pesanan PayPal tidak ditemukan.");
  if (order.status !== "PENDING" || order.payment.status !== "PENDING") throw new Error("Pesanan PayPal sudah berubah.");
  if (isUnpaidOrderExpired(order.createdAt)) throw new Error("Batas pembayaran 10 menit sudah lewat.");
  return order;
}

export async function assertPayPalOrderEligibility(order: CheckoutOrder, client: Parameters<typeof assertPayPalEligibleOrderItems>[1] = prisma) {
  await assertPayPalEligibleOrderItems(order.items, client);
}

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(operation, { isolationLevel: "Serializable" }); }
    catch (error) { if ((error as { code?: string }).code !== "P2034" || attempt === 2) throw error; }
  }
  throw new Error("Transaksi PayPal belum selesai.");
}

export async function assertPayPalSandboxEnvironment() {
  assertPayPalSandboxStorage();
  const instanceId = process.env.PAYPAL_SANDBOX_INSTANCE_ID?.trim();
  if (!instanceId) throw new Error("Identitas instance PayPal Sandbox belum dikonfigurasi.");
  const marker = await prisma.payPalSandboxEnvironment.findUnique({
    where: { id: "paypal-sandbox" }, select: { instanceId: true },
  });
  if (!marker || marker.instanceId !== instanceId) {
    throw new Error("Database ini bukan instance PayPal Sandbox yang diizinkan.");
  }
}

// Live intentionally has no Sandbox marker. Sandbox remains blocked unless both
// its isolated storage and database marker match before any payment operation.
async function assertPayPalEnvironment() {
  if (paypalConfig().mode === "sandbox") await assertPayPalSandboxEnvironment();
}

export async function createPayPalCheckout(orderId: string, userId: string) {
  await assertPayPalEnvironment();
  const config = paypalConfig();
  const prepared = await serializable(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: { include: { paypalCheckout: true } }, items: { include: { product: { select: { sellerId: true } } } } },
    }) as CheckoutOrder | null;
    const current = assertOwnedPending(order, userId);
    await assertPayPalOrderEligibility(current, tx);
    if (current.payment!.amount !== current.total) throw new Error("Nominal order PayPal tidak konsisten.");
    const amount = usdAmountForIdr(current.total, config.idrToUsdRate);
    const existing = current.payment!.paypalCheckout;
    if (existing && (existing.amount !== amount || existing.idrToUsdRate !== config.idrToUsdRate || existing.expectedMerchantId !== config.merchantId)) {
      throw new Error("Kurs atau merchant PayPal berubah. Buat pesanan baru.");
    }
    const checkout = existing ?? await tx.payPalCheckout.create({ data: {
      paymentId: current.payment!.id, currency: "USD", amount, idrToUsdRate: config.idrToUsdRate,
      expectedMerchantId: config.merchantId, expiresAt: getUnpaidOrderDeadline(current.createdAt),
    } });
    if (checkout.paypalOrderId) return { order: current, checkout, existingOrderId: checkout.paypalOrderId };
    return { order: current, checkout, existingOrderId: null };
  });
  if (prepared.existingOrderId) return { paypalOrderId: prepared.existingOrderId, amount: prepared.checkout.amount, currency: "USD", exchangeRate: prepared.checkout.idrToUsdRate };

  // PayPal-Request-Id is stable, so a retry after a timeout cannot create a second order.
  const remote = await createPayPalOrder({ requestId: `create-${prepared.order.payment!.id}`, orderNumber: prepared.order.orderNumber, orderId: prepared.order.id, amount: prepared.checkout.amount });
  if (!remote || typeof remote !== "object" || typeof (remote as { id?: unknown }).id !== "string") throw new Error("PayPal tidak mengembalikan order yang valid.");
  const paypalOrderId = (remote as { id: string }).id;
  await serializable(async (tx) => {
    const updated = await tx.payPalCheckout.updateMany({ where: { paymentId: prepared.order.payment!.id, paypalOrderId: null }, data: { paypalOrderId } });
    if (updated.count === 1) await tx.payment.update({ where: { id: prepared.order.payment!.id }, data: { externalId: `paypal:${paypalOrderId}` } });
  });
  return { paypalOrderId, amount: prepared.checkout.amount, currency: "USD", exchangeRate: prepared.checkout.idrToUsdRate };
}

export async function captureBuyerPayPalOrder(orderId: string, userId: string, paypalOrderId: string) {
  await assertPayPalEnvironment();
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { payment: { include: { paypalCheckout: true } }, items: { include: { product: { select: { sellerId: true } } } } } }) as CheckoutOrder | null;
  const current = assertOwnedPending(order, userId);
  await assertPayPalOrderEligibility(current);
  if (current.payment!.paypalCheckout?.paypalOrderId !== paypalOrderId) throw new Error("Order PayPal tidak cocok.");
  await capturePayPalOrder(paypalOrderId);
  const remote = await getPayPalOrder(paypalOrderId);
  const evidence = validatePayPalCapture(remote, {
    paypalOrderId, orderId: current.id, orderNumber: current.orderNumber,
    amount: current.payment!.paypalCheckout.amount, merchantId: current.payment!.paypalCheckout.expectedMerchantId,
  });
  // Capture can complete just after the pre-capture deadline check. Cancel first
  // so the resulting money movement is explicitly retained for admin review.
  if (isUnpaidOrderExpired(current.createdAt)) await autoCancelExpiredOrder(current.id);
  return persistPayPalCapture(paypalOrderId, evidence, `capture:${evidence.captureId}`, remote);
}

export async function processPayPalWebhook(paypalOrderId: string, eventId: string) {
  await assertPayPalEnvironment();
  const order = await prisma.order.findFirst({ where: { payment: { is: { paypalCheckout: { is: { paypalOrderId } } } } }, include: { payment: { include: { paypalCheckout: true } }, items: { include: { product: { select: { sellerId: true } } } } } }) as CheckoutOrder | null;
  if (!order?.payment?.paypalCheckout) throw new Error("Order PayPal webhook tidak ditemukan.");
  await assertPayPalOrderEligibility(order);
  const remote = await getPayPalOrder(paypalOrderId);
  const evidence = validatePayPalCapture(remote, { paypalOrderId, orderId: order.id, orderNumber: order.orderNumber, amount: order.payment.paypalCheckout.amount, merchantId: order.payment.paypalCheckout.expectedMerchantId });
  if (isUnpaidOrderExpired(order.createdAt)) await autoCancelExpiredOrder(order.id);
  return persistPayPalCapture(paypalOrderId, evidence, `webhook:${eventId}`, remote);
}

async function persistPayPalCapture(paypalOrderId: string, evidence: PayPalCaptureEvidence, eventId: string, payload: unknown) {
  const result = await serializable(async (tx) => {
    const order = await tx.order.findFirst({ where: { payment: { is: { paypalCheckout: { is: { paypalOrderId } } } } }, include: { payment: { include: { paypalCheckout: true } }, items: { include: { product: { select: { sellerId: true } } } } } }) as CheckoutOrder | null;
    if (!order?.payment?.paypalCheckout) throw new Error("Order PayPal tidak ditemukan.");
    await assertPayPalOrderEligibility(order, tx);
    try {
      await tx.paymentEvent.create({ data: { paymentId: order.payment.id, provider: "PAYPAL", providerEventId: eventId, eventType: "PAYPAL_CAPTURE_VERIFIED", payload: payload as Prisma.InputJsonValue } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { duplicate: true, paid: false, review: false, orderId: order.id };
      throw error;
    }
    if (order.payment.status === "PAID" || order.status === "PAID") return { duplicate: true, paid: false, review: false, orderId: order.id };
    const review = paypalCaptureNeedsReview({ orderStatus: order.status, paymentStatus: order.payment.status, createdAt: order.createdAt, now: new Date() });
    if (review) {
      await tx.payPalCheckout.update({ where: { paymentId: order.payment.id }, data: { status: "REVIEW_REQUIRED", captureId: evidence.captureId, capturedAt: new Date(), reviewReason: isUnpaidOrderExpired(order.createdAt) || order.status === "CANCELLED" || order.payment.status === "CANCELLED" ? "PAYMENT_AFTER_10_MINUTE_DEADLINE_OR_CANCELLATION" : "ORDER_STATE_CHANGED" } });
      await tx.auditLog.create({ data: { action: "PAYPAL_LATE_PAYMENT_REVIEW", entityType: "Order", entityId: order.id, metadata: { paypalOrderId, captureId: evidence.captureId } } });
      return { duplicate: false, paid: false, review: true, orderId: order.id, orderNumber: order.orderNumber };
    }
    const claimed = await tx.payment.updateMany({ where: { id: order.payment.id, status: "PENDING", provider: "PAYPAL", externalId: `paypal:${paypalOrderId}` }, data: { status: "PAID", paidAt: new Date() } });
    if (claimed.count !== 1) return { duplicate: true, paid: false, review: false, orderId: order.id };
    await tx.payPalCheckout.update({ where: { paymentId: order.payment.id }, data: { status: "CAPTURED", captureId: evidence.captureId, capturedAt: new Date(), reviewReason: null } });
    await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
    await createSellerEarningsForPaidOrder(tx, order.id);
    return { duplicate: false, paid: true, review: false, orderId: order.id, orderNumber: order.orderNumber };
  });
  if (result.paid) await fulfillPaidOrder(result.orderId);
  if (result.review) await notifyAdmins({ eventKey: `paypal-review:${paypalOrderId}`, title: "Pembayaran PayPal Perlu Review", message: `Capture PayPal untuk pesanan ${result.orderNumber} tiba terlambat atau setelah pembatalan. Produk tidak dikirim otomatis.`, link: "/admin/orders" });
  return result;
}
