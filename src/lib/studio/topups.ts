import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customerPaymentsAvailable, getPaymentProvider, paymentProviderName } from "@/lib/payments/provider";
import { getStudioTopUpPackage } from "./topup-packages";

const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);

export function validateStudioCreditTopUpSnapshot(input: { topUp: { userId: string; packageCode: string; packageName: string; price: number; credits: number }; order: { userId: string; subtotal: number; total: number }; payment: { amount: number } }) {
  const expected = getStudioTopUpPackage(input.topUp.packageCode);
  if (!expected || input.topUp.userId !== input.order.userId || input.topUp.packageName !== expected.name || input.topUp.price !== expected.price || input.topUp.credits !== expected.credits || input.order.subtotal !== expected.price || input.order.total !== expected.price || input.payment.amount !== expected.price) throw new Error("Data top up tidak konsisten.");
  return expected;
}

export async function createStudioCreditTopUp(userId: string, packageCode: string) {
  const studioPackage = getStudioTopUpPackage(packageCode);
  if (!studioPackage) throw new Error("Paket Studio Credit tidak tersedia.");
  if (!customerPaymentsAvailable()) throw new Error("Pembayaran online sedang dalam proses aktivasi.");
  const orderNumber = `KS-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const provider = paymentProviderName().toUpperCase();
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, name: true, email: true } });
    if (!user?.isActive) throw new Error("Akun tidak aktif.");
    return tx.order.create({ data: {
      orderNumber, userId: user.id, customerName: user.name?.trim() || "Customer", customerEmail: user.email.toLowerCase(),
      subtotal: studioPackage.price, total: studioPackage.price, status: "PENDING",
      payment: { create: { amount: studioPackage.price, provider, status: "PENDING" } },
      studioCreditTopUp: { create: { userId: user.id, packageCode: studioPackage.code, packageName: studioPackage.name, price: studioPackage.price, credits: studioPackage.credits } },
    }, include: { payment: true } });
  }, { isolationLevel: "Serializable" });
  if (!created.payment) throw new Error("Catatan pembayaran tidak dibuat.");
  // iPaymu and PayPal require their own draft metadata services. They are not
  // selectable as a default top-up provider until those services support this order type.
  if (["IPAYMU", "PAYPAL"].includes(provider)) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { id: created.payment!.id, status: "PENDING" }, data: { status: "FAILED" } });
      await tx.order.updateMany({ where: { id: created.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    });
    throw new Error("Metode pembayaran ini belum tersedia untuk top up Studio Credit.");
  }
  try {
    const payment = await getPaymentProvider().createPayment({
      orderId: created.id, orderNumber: created.orderNumber, amount: studioPackage.price,
      customer: { name: created.customerName, email: created.customerEmail },
      // This item exists only in the provider request, never as an OrderItem.
      items: [{ id: studioPackage.code, name: studioPackage.name, price: studioPackage.price, quantity: 1 }],
    });
    await prisma.payment.update({ where: { id: created.payment.id }, data: { externalId: payment.providerTransactionId } });
    if (provider === "SOCIABUZZ" && payment.providerTransactionId !== `scbz_draft:${(await import("@/lib/payments/sociabuzz-client")).sociaBuzzSessionId(created.id)}`) throw new Error("Identitas pembayaran tidak valid.");
    return { orderNumber: created.orderNumber, redirectUrl: payment.redirectUrl };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { id: created.payment!.id, status: "PENDING" }, data: { status: "FAILED" } });
      await tx.order.updateMany({ where: { id: created.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    });
    throw error;
  }
}

export async function fulfillStudioCreditTopUp(orderId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const topUp = await tx.studioCreditTopUp.findUnique({ where: { orderId }, include: { order: { include: { payment: true } } } });
        if (!topUp?.order.payment) throw new Error("Top up tidak ditemukan.");
        const expected = validateStudioCreditTopUpSnapshot({ topUp, order: topUp.order, payment: topUp.order.payment });
        if (topUp.order.status !== "PAID" || topUp.order.payment.status !== "PAID") throw new Error("Data top up tidak konsisten.");
        const existing = await tx.studioCreditTransaction.findUnique({ where: { topUpId: topUp.id } });
        if (existing) {
          if (existing.userId !== topUp.userId || existing.type !== "TOPUP_PURCHASE" || existing.amount !== expected.credits || existing.balanceAfter !== existing.balanceBefore + expected.credits) throw new Error("Ledger top up tidak konsisten.");
          await tx.studioCreditTopUp.updateMany({ where: { id: topUp.id, creditedAt: null }, data: { creditedAt: existing.createdAt } });
          await tx.order.updateMany({ where: { id: orderId, status: "PAID" }, data: { status: "COMPLETED", completedAt: new Date() } });
          return { duplicate: true, topUpId: topUp.id };
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: topUp.userId }, select: { studioCredits: true } });
        const balanceAfter = user.studioCredits + expected.credits;
        await tx.user.update({ where: { id: topUp.userId }, data: { studioCredits: balanceAfter } });
        await tx.studioCreditTransaction.create({ data: { userId: topUp.userId, topUpId: topUp.id, type: "TOPUP_PURCHASE", amount: expected.credits, balanceBefore: user.studioCredits, balanceAfter, description: `Top up Studio Credit pesanan ${topUp.order.orderNumber}` } });
        await tx.studioCreditTopUp.update({ where: { id: topUp.id }, data: { creditedAt: new Date() } });
        await tx.order.update({ where: { id: orderId }, data: { status: "COMPLETED", completedAt: new Date() } });
        await tx.auditLog.create({ data: { action: "STUDIO_CREDIT_TOPUP_FULFILLED", entityType: "StudioCreditTopUp", entityId: topUp.id, metadata: { orderId, packageCode: expected.code, amount: expected.price, credits: expected.credits, duplicate: false } } });
        return { duplicate: false, topUpId: topUp.id };
      }, { isolationLevel: "Serializable" });
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
  throw new Error("Top up belum dapat diproses.");
}

export async function markCreditedTopUpRefundForReview(orderId: string, reason: string) {
  return prisma.$transaction((tx) => markCreditedTopUpRefundForReviewTx(tx, orderId, reason));
}

export async function markCreditedTopUpRefundForReviewTx(tx: Prisma.TransactionClient, orderId: string, reason: string) {
  const topUp = await tx.studioCreditTopUp.findUnique({ where: { orderId }, select: { id: true, creditedAt: true } });
  if (!topUp?.creditedAt) return { topUpId: null, newlyMarked: false };
  const marked = await tx.studioCreditTopUp.updateMany({ where: { id: topUp.id, creditedAt: { not: null }, refundReviewAt: null }, data: { refundReviewAt: new Date(), refundReviewReason: reason.slice(0, 500) } });
  if (marked.count === 1) await tx.auditLog.create({ data: { action: "STUDIO_TOPUP_REFUND_REVIEW_REQUIRED", entityType: "StudioCreditTopUp", entityId: topUp.id, metadata: { orderId } } });
  return { topUpId: topUp.id, newlyMarked: marked.count === 1 };
}
