import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "./paid-order-fulfillment";
import { createSellerEarningsForPaidOrder } from "@/lib/seller-finance";
import { notifyAdmins } from "@/lib/admin-notifications";
import { ipaymuConfig, ipaymuRequest } from "./ipaymu-client";
import { parseVaEvidence, vaDraftSchema, type VaInvoice } from "./ipaymu-validation";

async function transaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (["P2034", "P2002"].includes((error as { code?: string }).code ?? "") && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Verifikasi pembayaran belum selesai.");
}

export async function verifyIpaymuOrder(orderId: string, userId?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { payment: true, studioCreditTopUp: { select: { id: true } } },
  });
  if (!order?.payment || order.payment.provider !== "IPAYMU") {
    throw new Error("Pesanan VA tidak ditemukan.");
  }

  if (order.payment.status === "PAID") {
    await notifyAdmins({
      eventKey: `ipaymu:paid:${order.payment.id}`,
      title: "Pembayaran VA Berhasil",
      message: `Pembayaran VA pesanan ${order.orderNumber} terverifikasi.`,
      link: "/admin/orders",
    });
    if (order.status === "PAID") await fulfillPaidOrder(order.id);
    return { status: "PAID" as const };
  }

  const externalId = order.payment.externalId ?? "";
  if (externalId.startsWith("ipaymu_draft:")) {
    return { status: order.payment.status };
  }
  if (!/^ipaymu:[0-9]+$/.test(externalId)) {
    throw new Error("Identitas invoice VA belum pasti; perlu pemulihan.");
  }
  const transactionId = externalId.slice("ipaymu:".length);

  const [draftEvent, invoiceEvent] = await Promise.all([
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `draft:${order.id}`,
      } },
    }),
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `invoice:${order.id}`,
      } },
    }),
  ]);
  if (
    !draftEvent || !invoiceEvent ||
    draftEvent.paymentId !== order.payment.id ||
    invoiceEvent.paymentId !== order.payment.id ||
    draftEvent.eventType !== "IPAYMU_VA_DRAFT" ||
    invoiceEvent.eventType !== "IPAYMU_VA_CREATED"
  ) throw new Error("Catatan invoice VA tidak lengkap.");

  const draft = vaDraftSchema.parse(draftEvent.payload);
  const invoice = invoiceEvent.payload as unknown as VaInvoice;
  if (
    draft.mode !== ipaymuConfig().mode ||
    invoice.transactionId !== transactionId ||
    invoice.referenceId !== order.id ||
    invoice.bank !== draft.bank ||
    invoice.amount !== order.total ||
    invoice.fee !== draft.fee ||
    invoice.total !== order.total + draft.fee ||
    order.payment.amount !== order.total
  ) throw new Error("Catatan invoice VA tidak cocok.");

  const evidence = parseVaEvidence(
    await ipaymuRequest("POST", "/api/v2/transaction", { transactionId }),
    { transactionId, referenceId: order.id, amount: order.total, fee: draft.fee },
  );
  if (!evidence.paid) {
    return { status: order.payment.status, gatewayStatus: evidence.gatewayStatus };
  }

  const result = await transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: order.id },
      include: { payment: true },
    });
    if (
      !current?.payment ||
      current.userId !== order.userId ||
      current.payment.provider !== "IPAYMU" ||
      current.payment.externalId !== externalId ||
      current.total !== order.total ||
      current.payment.amount !== order.total
    ) throw new Error("Pesanan berubah saat verifikasi VA.");

    if (current.payment.status === "PAID") {
      return { status: "PAID" as const, late: false };
    }

    if (current.status === "CANCELLED" && current.payment.status === "CANCELLED") {
      const reference = {
        type: "REFUND_CREDIT" as const,
        referenceType: "IpaymuLatePayment",
        referenceId: current.payment.id,
      };
      const existing = await tx.walletTransaction.findUnique({
        where: { type_referenceType_referenceId: reference },
      });
      if (existing) {
        if (existing.userId !== current.userId || existing.amount !== current.total) {
          throw new Error("Catatan pengembalian VA tidak cocok.");
        }
        return { status: "CANCELLED" as const, late: true };
      }
      // paidAt yang sudah terisi dapat berasal dari pembatalan pesanan berbayar.
      if (current.payment.paidAt) {
        return { status: "CANCELLED" as const, late: false };
      }

      const user = await tx.user.findUniqueOrThrow({
        where: { id: current.userId }, select: { balance: true },
      });
      const balanceAfter = user.balance + current.total;
      await tx.user.update({
        where: { id: current.userId }, data: { balance: balanceAfter },
      });
      await tx.walletTransaction.create({
        data: {
          ...reference,
          userId: current.userId,
          amount: current.total,
          balanceBefore: user.balance,
          balanceAfter,
          description: `Pembayaran VA terlambat pesanan ${current.orderNumber}`,
        },
      });
      await tx.payment.update({
        where: { id: current.payment.id }, data: { paidAt: new Date() },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: current.payment.id,
          provider: "IPAYMU",
          providerEventId: `late-credit:${transactionId}`,
          eventType: "IPAYMU_LATE_PAYMENT_WALLET_CREDIT",
          payload: { orderId: current.id, amount: current.total, transactionId },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "IPAYMU_LATE_PAYMENT_CREDITED",
          entityType: "Order", entityId: current.id,
          metadata: { amount: current.total, transactionId },
        },
      });
      return { status: "CANCELLED" as const, late: true };
    }

    if (current.status !== "PENDING" || current.payment.status !== "PENDING") {
      throw new Error("Pembayaran VA perlu ditinjau admin.");
    }
    const claimed = await tx.payment.updateMany({
      where: {
        id: current.payment.id,
        provider: "IPAYMU",
        externalId,
        status: "PENDING",
        order: { is: { status: "PENDING" } },
      },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Pembayaran VA sudah berubah.");
    await tx.order.update({
      where: { id: current.id }, data: { status: "PAID" },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: current.payment.id,
        provider: "IPAYMU",
        providerEventId: `paid:${transactionId}`,
        eventType: "IPAYMU_PAYMENT_PAID",
        payload: { orderId: current.id, amount: current.total, transactionId },
      },
    });
    await createSellerEarningsForPaidOrder(tx, current.id);
    return { status: "PAID" as const, late: false };
  });

  if (result.status === "PAID" || result.late) {
    await notifyAdmins({
      eventKey: `ipaymu:${result.late ? "late-credit" : "paid"}:${order.payment.id}`,
      title: result.late ? "Pembayaran VA Terlambat" : "Pembayaran VA Berhasil",
      message: result.late
        ? `Nilai produk pesanan ${order.orderNumber} dikreditkan ke saldo pembeli.`
        : `Pembayaran VA pesanan ${order.orderNumber} terverifikasi.`,
      link: "/admin/orders",
    });
  }

  if (result.status === "PAID") {
    const latest = await prisma.order.findUnique({ where: { id: order.id } });
    if (latest?.status === "PAID") await fulfillPaidOrder(order.id);
  }
  return { status: result.status };
}
