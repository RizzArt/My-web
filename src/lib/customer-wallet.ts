import { assertIpaymuAlternativeAllowed } from "@/lib/payments/ipaymu-guard";
import { assertSociaBuzzAlternativeAllowed } from "@/lib/payments/sociabuzz-guard";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "@/lib/payments/paid-order-fulfillment";
import { isUnpaidOrderExpired } from "@/lib/order-expiry";
import { validateStudioCreditTopUpSnapshot } from "@/lib/studio/topups";

function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"; }

export async function payOrderWithBalance(orderId: string, userId: string) {
  let paidOrderId = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: { payment: true, studioCreditTopUp: { select: { id: true, userId: true, packageCode: true, packageName: true, price: true, credits: true } } } });
        if (!order?.payment) throw new Error("Pesanan tidak ditemukan.");
        if (order.status === "CANCELLED" || order.payment.status === "CANCELLED") throw new Error("Pesanan sudah dibatalkan.");
        if (order.payment.status === "PAID") { paidOrderId = order.id; return; }
        if (isUnpaidOrderExpired(order.createdAt)) throw new Error("Batas pembayaran 10 menit sudah lewat.");
        assertSociaBuzzAlternativeAllowed(order.payment);
        assertIpaymuAlternativeAllowed(order.payment);
        if (order.payment.status !== "PENDING" || order.status !== "PENDING") throw new Error("Pesanan tidak dapat dibayar dengan saldo.");
        if (order.studioCreditTopUp) {
          validateStudioCreditTopUpSnapshot({ topUp: order.studioCreditTopUp, order, payment: order.payment });
          const existing = await tx.studioCreditTransaction.findUnique({ where: { topUpId: order.studioCreditTopUp.id } });
          if (existing) throw new Error("Ledger top up tidak konsisten.");
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true, isActive: true } });
        if (!user.isActive) throw new Error("Akun tidak aktif.");
        if (user.balance < order.total) throw new Error("Saldo Akun tidak mencukupi.");
        const balanceAfter = user.balance - order.total;
        await tx.user.update({ where: { id: userId }, data: { balance: balanceAfter } });
        await tx.walletTransaction.create({ data: { userId, type: "PURCHASE_DEBIT", amount: -order.total, balanceBefore: user.balance, balanceAfter, referenceType: "Order", referenceId: order.id, description: `Pembelian order ${order.orderNumber}` } });
        await tx.payment.update({ where: { id: order.payment.id }, data: { status: "PAID", provider: "WALLET", externalId: `wallet:${order.id}`, paidAt: new Date() } });
        await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
        paidOrderId = order.id;
      }, { isolationLevel: "Serializable" });
      break;
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
  if (paidOrderId) await fulfillPaidOrder(paidOrderId);
  return { orderId: paidOrderId };
}
