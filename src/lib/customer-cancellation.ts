import { assertSociaBuzzAlternativeAllowed, hasActiveSociaBuzzInvoice } from "@/lib/payments/sociabuzz-guard";
import { cancelActiveSociaBuzzOrder } from "@/lib/payments/sociabuzz-cancellation";
import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reverseOrderEarnings } from "@/lib/seller-finance";
import { isUnpaidOrderExpired } from "@/lib/order-expiry";

function retryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function releaseReservedInventory(tx: Prisma.TransactionClient, orderId: string) {
  await tx.digitalInventory.updateMany({
    where: { assignedOrderId: orderId, status: "ASSIGNED", isSold: false },
    data: { status: "AVAILABLE", isSold: false, assignedOrderId: null, assignedOrderItemId: null, assignedAt: null },
  });
}

export async function cancelUnpaidOrder(orderId: string, userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: { payment: true, deliveries: { select: { status: true } } } });
        if (!order) throw new Error("Pesanan tidak ditemukan.");
        if (order.status === "CANCELLED" || order.payment?.status === "CANCELLED") return { status: "CANCELLED" as const };
        if (order.status === "COMPLETED" || order.deliveries.some((delivery) => ["DELIVERED", "AWAITING_CONFIRMATION"].includes(delivery.status))) throw new Error("Pesanan ini tidak dapat dibatalkan.");
        if (order.payment?.status === "PAID" || order.status === "PAID" || order.status === "PROCESSING") throw new Error("Pesanan sudah dibayar. Ajukan pembatalan untuk ditinjau admin.");
        if (hasActiveSociaBuzzInvoice(order.payment)) {
          return cancelActiveSociaBuzzOrder(tx, order.id, userId);
        }
        assertSociaBuzzAlternativeAllowed(order.payment);
        const claimed = await tx.order.updateMany({ where: { id: order.id, userId, status: { in: ["PENDING", "EXPIRED"] }, payment: { is: { status: { in: ["PENDING", "EXPIRED", "FAILED"] } } } }, data: { status: "CANCELLED" } });
        if (claimed.count !== 1) throw new Error("Pesanan sudah diproses.");
        if (order.payment) await tx.payment.updateMany({ where: { id: order.payment.id, status: { in: ["PENDING", "EXPIRED", "FAILED"] } }, data: { status: "CANCELLED" } });
        await releaseReservedInventory(tx, order.id);
        await tx.auditLog.create({ data: { actorId: userId, action: "ORDER_CANCELLED_UNPAID", entityType: "Order", entityId: order.id } });
        return { status: "CANCELLED" as const };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Pesanan tidak dapat dibatalkan.");
}

export async function autoCancelExpiredOrder(orderId: string, now = new Date()) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { payment: true, deliveries: { select: { status: true } } } });
        if (!order?.payment) return { status: "SKIPPED" as const };
        if (!isUnpaidOrderExpired(order.createdAt, now)) return { status: "NOT_DUE" as const };
        if (order.status === "CANCELLED" || order.payment.status === "CANCELLED") return { status: "CANCELLED" as const };
        if (order.status === "PAID" || order.status === "PROCESSING" || order.payment.status === "PAID") return { status: "PAID" as const };
        if (order.status === "COMPLETED" || order.deliveries.some((delivery) => ["DELIVERED", "AWAITING_CONFIRMATION"].includes(delivery.status))) return { status: "SKIPPED" as const };
        if (order.payment.provider === "SOCIABUZZ" && order.payment.externalId?.startsWith("scbz:")) return cancelActiveSociaBuzzOrder(tx, order.id, null, true);
        const claimed = await tx.order.updateMany({ where: { id: order.id, status: { in: ["PENDING", "EXPIRED"] }, payment: { is: { status: { in: ["PENDING", "EXPIRED", "FAILED"] } } } }, data: { status: "CANCELLED" } });
        if (claimed.count !== 1) return { status: "SKIPPED" as const };
        const payment = await tx.payment.updateMany({ where: { id: order.payment.id, status: { in: ["PENDING", "EXPIRED", "FAILED"] } }, data: { status: "CANCELLED" } });
        if (payment.count !== 1) throw new Error("Pembayaran berubah saat pembatalan otomatis.");
        await releaseReservedInventory(tx, order.id);
        await tx.auditLog.create({ data: { action: "ORDER_AUTO_CANCELLED_UNPAID", entityType: "Order", entityId: order.id, metadata: { reason: "UNPAID_TIMEOUT_10_MINUTES", deadline: new Date(order.createdAt.getTime() + 10 * 60 * 1000).toISOString() } } });
        return { status: "CANCELLED" as const };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Pembatalan otomatis belum selesai.");
}

export async function requestPaidCancellation(orderId: string, userId: string, reason: string) {
  return adminNotifiedTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: { payment: true, deliveries: { select: { status: true } }, cancellationRequest: true } });
    if (!order) throw new Error("Pesanan tidak ditemukan.");
    if (order.status === "COMPLETED" || order.deliveries.some((delivery) => ["DELIVERED", "AWAITING_CONFIRMATION"].includes(delivery.status))) throw new Error("Produk sudah dikirim. Gunakan flow refund jika memenuhi syarat.");
    if (order.payment?.status !== "PAID" || !["PAID", "PROCESSING"].includes(order.status)) throw new Error("Pesanan ini dapat dibatalkan langsung atau tidak memenuhi syarat.");
    if (order.cancellationRequest) throw new Error("Pengajuan pembatalan sudah ada.");
    return tx.cancellationRequest.create({ data: { orderId, userId, amount: order.total, reason } });
  }, (result) => ({
      eventKey: `cancellation-request:${result.id}`,
      title: "Pengajuan Pembatalan Pesanan",
      message: "Ada pengajuan pembatalan pesanan yang sudah dibayar.",
      link: "/admin/cancellations"
    }), { isolationLevel: "Serializable" });
}

export async function reviewCancellation(requestId: string, adminId: string, approve: boolean, adminNote?: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const request = await tx.cancellationRequest.findUnique({ where: { id: requestId }, include: { order: { include: { payment: true, deliveries: true } } } });
        if (!request) throw new Error("Pengajuan pembatalan tidak ditemukan.");
        const claimed = await tx.cancellationRequest.updateMany({ where: { id: requestId, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedAt: new Date(), reviewedById: adminId, adminNote: adminNote || null } });
        if (claimed.count !== 1) throw new Error("Pengajuan sudah diproses.");
        if (!approve) return tx.cancellationRequest.findUniqueOrThrow({ where: { id: requestId } });
        const orderClaim = await tx.order.updateMany({ where: { id: request.orderId, status: { in: ["PAID", "PROCESSING"] }, payment: { is: { status: "PAID" } } }, data: { status: "CANCELLED" } });
        if (orderClaim.count !== 1) throw new Error("Order sudah berubah dan tidak dapat dibatalkan.");
        await tx.payment.updateMany({ where: { orderId: request.orderId, status: "PAID" }, data: { status: "CANCELLED" } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: request.userId }, select: { balance: true } });
        const balanceAfter = user.balance + request.amount;
        await tx.user.update({ where: { id: request.userId }, data: { balance: balanceAfter } });
        await tx.walletTransaction.create({ data: { userId: request.userId, type: "REFUND_CREDIT", amount: request.amount, balanceBefore: user.balance, balanceAfter, referenceType: "CancellationRequest", referenceId: request.id, description: `Pembatalan order ${request.order.orderNumber}` } });
        await reverseOrderEarnings(tx, request.orderId, `Pembatalan Pesanan #${request.order.orderNumber}`);
        await releaseReservedInventory(tx, request.orderId);
        return tx.cancellationRequest.findUniqueOrThrow({ where: { id: requestId } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Pembatalan tidak dapat diproses.");
}
