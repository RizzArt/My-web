import { reconcileCancelledSociaBuzzOrder } from "./sociabuzz-cancellation";
import { isUnpaidOrderExpired } from "@/lib/order-expiry";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "./paid-order-fulfillment";
import { createSellerEarningsForPaidOrder } from "@/lib/seller-finance";
import { notifyAdmins } from "@/lib/admin-notifications";
import {
  checkSociaBuzzPayment,
  createSociaBuzzQr,
  sociaBuzzSessionId,
} from "./sociabuzz-client";

async function transaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2034" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Transaksi pembayaran belum selesai.");
}

export async function generateSociaBuzzQr(orderId: string, userId: string) {
  const order = await transaction(async (tx) => {
    const current = await tx.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: true },
    });
    if (!current?.payment) throw new Error("Pesanan tidak ditemukan.");
    if (isUnpaidOrderExpired(current.createdAt)) {
      throw new Error("Batas pembayaran 10 menit sudah lewat.");
    }
    if (
      current.status !== "PENDING" ||
      current.payment.status !== "PENDING" ||
      current.payment.provider !== "SOCIABUZZ"
    ) {
      throw new Error("Pesanan tidak dapat dibuatkan QRIS.");
    }
    if (current.total <= 0 || current.total % 1000 !== 0) {
      throw new Error("QRIS SociaBuzz saat ini memerlukan total kelipatan Rp1.000.");
    }

    const id = sociaBuzzSessionId(current.id);
    const draft = `scbz_draft:${id}`;
    const active = `scbz:${id}`;
    if (current.payment.externalId === active) return current;
    if (current.payment.externalId !== draft) {
      throw new Error("Identitas pembayaran tidak sesuai.");
    }

    const claimed = await tx.payment.updateMany({
      where: {
        id: current.payment.id,
        provider: "SOCIABUZZ",
        status: "PENDING",
        externalId: draft,
        order: { is: { status: "PENDING" } },
      },
      data: { externalId: active },
    });
    if (claimed.count !== 1) throw new Error("Metode pembayaran sudah berubah.");
    return current;
  });

  // Kunci tetap dipertahankan jika hasil permintaan gateway belum pasti.
  const qr = await createSociaBuzzQr({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount: order.total,
    name: order.customerName,
    email: order.customerEmail,
  });

  await transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { orderId: order.id },
    });
    if (
      !payment ||
      payment.provider !== "SOCIABUZZ" ||
      payment.externalId !== `scbz:${qr.id}` ||
      payment.status !== "PENDING"
    ) {
      throw new Error("Pembayaran sudah berubah. Periksa status pesanan.");
    }

    const eventId = `qr:${qr.id}`;
    const existing = await tx.paymentEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: "SOCIABUZZ",
          providerEventId: eventId,
        },
      },
    });
    if (existing) {
      const payload = existing.payload as { invoiceId?: string };
      if (
        existing.paymentId !== payment.id ||
        payload.invoiceId !== qr.invoiceId
      ) {
        throw new Error("Invoice berbeda dari catatan pembayaran.");
      }
      return;
    }

    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: "SOCIABUZZ",
        providerEventId: eventId,
        eventType: "QR_CREATED",
        payload: {
          invoiceId: qr.invoiceId,
          amount: qr.amount,
          currency: qr.currency,
          totalPay: qr.totalPay,
        },
      },
    });
  });

  return qr;
}

export async function verifySociaBuzzOrder(
  orderId: string,
  userId?: string,
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { payment: true, studioCreditTopUp: { select: { id: true } } },
  });
  if (!order?.payment) throw new Error("Pesanan tidak ditemukan.");
  const id = sociaBuzzSessionId(order.id);

  if (
    order.payment.provider !== "SOCIABUZZ" ||
    order.payment.externalId !== `scbz:${id}`
  ) {
    throw new Error("Invoice QRIS belum dibuat.");
  }

  if (order.status === "CANCELLED" && order.payment.status === "CANCELLED") {
    return reconcileCancelledSociaBuzzOrder(order.id, userId);
  }

  if (order.payment.status !== "PENDING") {
    if (order.payment.status === "PAID" && order.status === "PAID") {
      await fulfillPaidOrder(order.id);
    }
    return { status: order.payment.status };
  }

  const evidence = await checkSociaBuzzPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount: order.total,
  });

  const changed = await transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: order.id },
      include: { payment: true },
    });
    if (
      !current?.payment ||
      current.payment.provider !== "SOCIABUZZ" ||
      current.payment.externalId !== `scbz:${id}`
    ) {
      throw new Error("Identitas pembayaran sudah berubah.");
    }

    const event = await tx.paymentEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: "SOCIABUZZ",
          providerEventId: `qr:${id}`,
        },
      },
    });
    const payload = event?.payload as { invoiceId?: string } | undefined;
    if (event) {
      if (
        event.paymentId !== current.payment.id ||
        payload?.invoiceId !== evidence.invoiceId
      ) {
        throw new Error("Invoice belum cocok dengan catatan pesanan.");
      }
    } else {
      // Pulihkan metadata dari gateway privat yang sudah memvalidasi
      // session ID, order ID, nomor pesanan, nominal, dan mata uang.
      await tx.paymentEvent.create({
        data: {
          paymentId: current.payment.id,
          provider: "SOCIABUZZ",
          providerEventId: `qr:${id}`,
          eventType: "QR_RECOVERED",
          payload: {
            invoiceId: evidence.invoiceId,
            amount: evidence.amount,
            currency: evidence.currency,
          },
        },
      });
    }

    if (
      current.total !== evidence.amount ||
      current.payment.amount !== evidence.amount ||
      current.orderNumber !== evidence.orderNumber
    ) {
      throw new Error("Nominal pembayaran sudah berubah.");
    }

    if (evidence.status === "expired" || evidence.status === "failed") {
      if (current.payment.status === "PAID") return false;
      if (
        current.payment.status !== "PENDING" ||
        current.status !== "PENDING"
      ) {
        throw new Error("Status pesanan sudah berubah.");
      }

      const linkedDeliveries = await tx.digitalDelivery.count({
        where: {
          orderId: current.id,
          OR: [
            { inventoryId: { not: null } },
            { status: { in: ["DELIVERED", "AWAITING_CONFIRMATION"] } },
          ],
        },
      });
      if (linkedDeliveries > 0) {
        throw new Error("Stok pengiriman perlu ditinjau admin.");
      }

      const terminalStatus = evidence.status === "expired" ? "EXPIRED" : "FAILED";
      const ended = await tx.payment.updateMany({
        where: {
          id: current.payment.id,
          provider: "SOCIABUZZ",
          externalId: `scbz:${id}`,
          status: "PENDING",
          order: { is: { status: "PENDING" } },
        },
        data: { status: terminalStatus },
      });
      if (ended.count !== 1) throw new Error("Pembayaran sudah berubah.");

      await tx.order.update({
        where: { id: current.id },
        data: { status: "EXPIRED" },
      });
      await tx.digitalInventory.updateMany({
        where: {
          assignedOrderId: current.id,
          status: "ASSIGNED",
          isSold: false,
        },
        data: {
          status: "AVAILABLE",
          assignedOrderId: null,
          assignedOrderItemId: null,
          assignedAt: null,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: current.payment.id,
          provider: "SOCIABUZZ",
          providerEventId: `terminal:${evidence.invoiceId}:${terminalStatus}`,
          eventType: `PAYMENT_${terminalStatus}`,
          payload: {
            invoiceId: evidence.invoiceId,
            amount: evidence.amount,
            currency: evidence.currency,
          },
        },
      });
      return false;
    }

    if (evidence.status !== "paid") return false;
    if (current.payment.status === "PAID") return false;
    if (
      current.payment.status !== "PENDING" ||
      current.status !== "PENDING"
    ) {
      throw new Error("Pembayaran perlu ditinjau admin.");
    }

    const claimed = await tx.payment.updateMany({
      where: {
        id: current.payment.id,
        status: "PENDING",
        provider: "SOCIABUZZ",
        externalId: `scbz:${id}`,
      },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Pembayaran sudah diproses.");

    await tx.order.update({
      where: { id: current.id },
      data: { status: "PAID" },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: current.payment.id,
        provider: "SOCIABUZZ",
        providerEventId: `paid:${evidence.invoiceId}`,
        eventType: "PAYMENT_PAID",
        payload: {
          invoiceId: evidence.invoiceId,
          amount: evidence.amount,
          currency: evidence.currency,
        },
      },
    });
    await createSellerEarningsForPaidOrder(tx, current.id);
    return true;
  });

  if (changed) {
    await notifyAdmins({
      eventKey: `sociabuzz-paid:${order.payment.id}`,
      title: "Pembayaran QRIS Berhasil",
      message: `Pembayaran pesanan ${order.orderNumber} telah terverifikasi.`,
      link: "/admin/orders",
    });
  }

  const finalOrder = await prisma.order.findUnique({
    where: { id: order.id },
    include: { payment: true },
  });
  if (
    finalOrder?.payment?.status === "PAID" &&
    finalOrder.status === "PAID"
  ) {
    await fulfillPaidOrder(order.id);
  }
  return { status: finalOrder?.payment?.status ?? "PENDING" };
}
