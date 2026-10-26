import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyAdmins } from "@/lib/admin-notifications";
import { checkSociaBuzzPayment, sociaBuzzSessionId } from "./sociabuzz-client";

function event(tx: Prisma.TransactionClient, key: string) {
  return tx.paymentEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "SOCIABUZZ",
        providerEventId: key,
      },
    },
  });
}

async function transaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (["P2034", "P2002"].includes(code ?? "") && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Transaksi pembatalan belum selesai.");
}

export async function cancelActiveSociaBuzzOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  userId: string | null,
  automatic = false,
) {
  // This immutable timestamp defines the late-payment reconciliation lifetime.
  const monitoringStartedAt = new Date();
  const order = await tx.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { payment: true },
  });
  const id = sociaBuzzSessionId(orderId);
  if (
    !order?.payment ||
    !["PENDING", "EXPIRED"].includes(order.status) ||
    !["PENDING", "EXPIRED", "FAILED"].includes(order.payment.status) ||
    order.payment.provider !== "SOCIABUZZ" ||
    order.payment.externalId !== `scbz:${id}` ||
    order.payment.amount !== order.total
  ) throw new Error("Pesanan sudah berubah dan tidak dapat dibatalkan.");

  const linked = await tx.digitalDelivery.count({
    where: {
      orderId,
      OR: [
        { inventoryId: { not: null } },
        { status: { in: ["DELIVERED", "AWAITING_CONFIRMATION"] } },
      ],
    },
  });
  if (linked > 0) throw new Error("Pengiriman pesanan perlu ditinjau admin.");

  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      ...(userId ? { userId } : {}),
      status: { in: ["PENDING", "EXPIRED"] },
      payment: {
        is: {
          provider: "SOCIABUZZ",
          status: { in: ["PENDING", "EXPIRED", "FAILED"] },
          externalId: `scbz:${id}`,
        },
      },
    },
    data: { status: "CANCELLED" },
  });
  if (claimed.count !== 1) throw new Error("Pesanan sudah diproses.");

  const payment = await tx.payment.updateMany({
    where: {
      id: order.payment.id,
      provider: "SOCIABUZZ",
      status: { in: ["PENDING", "EXPIRED", "FAILED"] },
      externalId: `scbz:${id}`,
      order: { is: { status: "CANCELLED" } },
    },
    data: {
      status: "CANCELLED",
      lateMonitoringStartedAt: monitoringStartedAt,
      lateLastCheckedAt: null,
    },
  });
  if (payment.count !== 1) throw new Error("Pembayaran sudah diproses.");

  await tx.paymentEvent.create({
    data: {
      paymentId: order.payment.id,
      provider: "SOCIABUZZ",
      providerEventId: `cancel:${id}`,
      eventType: "SOCIABUZZ_CANCELLED_MONITORING",
      createdAt: monitoringStartedAt,
      payload: { orderId, userId: order.userId, amount: order.total },
    },
  });
  await tx.digitalInventory.updateMany({
    where: { assignedOrderId: orderId, status: "ASSIGNED", isSold: false },
    data: {
      status: "AVAILABLE",
      assignedOrderId: null,
      assignedOrderItemId: null,
      assignedAt: null,
    },
  });
  await tx.auditLog.create({
    data: {
      actorId: userId,
      action: automatic ? "ORDER_AUTO_CANCELLED_UNPAID_SOCIABUZZ" : "ORDER_CANCELLED_SOCIABUZZ",
      entityType: "Order",
      entityId: orderId,
    },
  });
  return { status: "CANCELLED" as const };
}

export async function reconcileCancelledSociaBuzzOrder(
  orderId: string,
  userId?: string,
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { payment: true },
  });
  if (!order?.payment) throw new Error("Pesanan tidak ditemukan.");
  const id = sociaBuzzSessionId(order.id);
  const payment = order.payment;
  if (
    order.status !== "CANCELLED" ||
    payment.status !== "CANCELLED" ||
    payment.provider !== "SOCIABUZZ" ||
    payment.externalId !== `scbz:${id}`
  ) throw new Error("Identitas pembatalan tidak cocok.");

  const cancellation = await event(prisma, `cancel:${id}`);
  const cancelled = cancellation?.payload as {
    orderId?: string; userId?: string; amount?: number;
  } | undefined;
  if (
    cancellation?.eventType !== "SOCIABUZZ_CANCELLED_MONITORING" ||
    cancellation.paymentId !== payment.id ||
    cancelled?.orderId !== order.id ||
    cancelled.userId !== order.userId ||
    cancelled.amount !== order.total
  ) return { status: "CANCELLED" as const };

  const creditKey = `late-credit:${id}`;
  let receipt = await event(prisma, creditKey);
  if (!receipt) {
    if (payment.paidAt) {
      throw new Error("Catatan pembayaran terlambat perlu ditinjau admin.");
    }
    const evidence = await checkSociaBuzzPayment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.total,
    });
    if (
      evidence.orderNumber !== order.orderNumber ||
      evidence.amount !== order.total ||
      evidence.currency !== "IDR"
    ) throw new Error("Bukti pembayaran terlambat tidak cocok.");
    if (evidence.status !== "paid") return { status: "CANCELLED" as const };

    receipt = await transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: order.id },
        include: { payment: true },
      });
      if (
        !current?.payment ||
        current.userId !== order.userId ||
        current.status !== "CANCELLED" ||
        current.payment.status !== "CANCELLED" ||
        current.payment.provider !== "SOCIABUZZ" ||
        current.payment.externalId !== `scbz:${id}` ||
        current.total !== evidence.amount ||
        current.payment.amount !== evidence.amount ||
        current.orderNumber !== evidence.orderNumber
      ) throw new Error("Pesanan berubah; pengembalian perlu ditinjau.");

      const marker = await event(tx, `cancel:${id}`);
      if (
        marker?.id !== cancellation.id ||
        marker.paymentId !== current.payment.id
      ) throw new Error("Catatan pembatalan berubah.");

      const existing = await event(tx, creditKey);
      if (existing) return existing;

      const qr = await event(tx, `qr:${id}`);
      const qrPayload = qr?.payload as { invoiceId?: string } | undefined;
      if (qr && (
        qr.paymentId !== current.payment.id ||
        qrPayload?.invoiceId !== evidence.invoiceId
      )) throw new Error("Invoice berbeda dari catatan pembayaran.");

      const ledger = await tx.walletTransaction.findUnique({
        where: {
          type_referenceType_referenceId: {
            type: "REFUND_CREDIT",
            referenceType: "SociaBuzzLatePayment",
            referenceId: current.payment.id,
          },
        },
      });
      if (ledger) throw new Error("Catatan pengembalian perlu ditinjau admin.");

      const user = await tx.user.findUniqueOrThrow({
        where: { id: current.userId },
        select: { balance: true },
      });
      const balanceAfter = user.balance + current.total;
      await tx.user.update({
        where: { id: current.userId },
        data: { balance: balanceAfter },
      });
      await tx.walletTransaction.create({
        data: {
          userId: current.userId,
          type: "REFUND_CREDIT",
          amount: current.total,
          balanceBefore: user.balance,
          balanceAfter,
          referenceType: "SociaBuzzLatePayment",
          referenceId: current.payment.id,
          description: `Pembayaran terlambat pesanan ${current.orderNumber}`,
        },
      });
      return tx.paymentEvent.create({
        data: {
          paymentId: current.payment.id,
          provider: "SOCIABUZZ",
          providerEventId: creditKey,
          eventType: "SOCIABUZZ_LATE_PAYMENT_WALLET_CREDIT",
          payload: {
            orderId: current.id,
            userId: current.userId,
            amount: current.total,
            invoiceId: evidence.invoiceId,
          },
        },
      });
    });
  }

  const credited = receipt.payload as {
    orderId?: string; userId?: string; amount?: number;
  };
  if (
    receipt.paymentId !== payment.id ||
    receipt.eventType !== "SOCIABUZZ_LATE_PAYMENT_WALLET_CREDIT" ||
    credited.orderId !== order.id ||
    credited.userId !== order.userId ||
    credited.amount !== order.total
  ) throw new Error("Catatan pengembalian saldo tidak cocok.");

  if (!payment.paidAt) {
    // Jika notifikasi gagal, worker mengulang dari receipt tanpa kredit ulang.
    await notifyAdmins({
      eventKey: `sociabuzz-late-credit:${payment.id}`,
      title: "Pembayaran Terlambat Dikembalikan",
      message: `Nilai pesanan ${order.orderNumber} dikembalikan ke saldo pembeli. Produk tidak dikirim.`,
      link: "/admin/orders",
    });
    await prisma.payment.updateMany({
      where: {
        id: payment.id,
        provider: "SOCIABUZZ",
        externalId: `scbz:${id}`,
        status: "CANCELLED",
        paidAt: null,
        order: { is: { status: "CANCELLED" } },
      },
      data: { paidAt: new Date() },
    });
  }
  return { status: "CANCELLED" as const };
}
