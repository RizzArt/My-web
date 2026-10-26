import { saveIpaymuInvoice } from "./ipaymu-record";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUnpaidOrderDeadline } from "@/lib/order-expiry";
import { ipaymuConfig, ipaymuRequest } from "./ipaymu-client";
import { selectVaBank } from "./ipaymu-options";
import { parseVaInvoice, vaDraftSchema, type VaInvoice } from "./ipaymu-validation";

async function transaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error as { code?: string }).code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Transaksi VA belum selesai.");
}

export async function createIpaymuInvoice(orderId: string, userId: string) {
  if (process.env.IPAYMU_ENABLED !== "true") {
    throw new Error("Virtual Account belum diaktifkan.");
  }

  const config = ipaymuConfig();
  const callback = process.env.IPAYMU_CALLBACK_URL;
  if (!callback) throw new Error("URL callback iPaymu belum dikonfigurasi.");
  const callbackUrl = new URL(callback);
  if (
    callbackUrl.protocol !== "https:" ||
    callbackUrl.pathname !== "/api/payments/ipaymu/callback" ||
    callbackUrl.username || callbackUrl.password ||
    callbackUrl.search || callbackUrl.hash
  ) throw new Error("URL callback iPaymu tidak sesuai.");

  const initial = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { payment: true },
  });
  if (!initial?.payment || initial.payment.provider !== "IPAYMU") {
    throw new Error("Pesanan VA tidak ditemukan.");
  }

  const existing = await prisma.paymentEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `invoice:${orderId}`,
      },
    },
  });
  if (existing) {
    if (
      existing.paymentId !== initial.payment.id ||
      existing.eventType !== "IPAYMU_VA_CREATED"
    ) throw new Error("Catatan invoice tidak sesuai.");
    return existing.payload as unknown as VaInvoice;
  }

  const draftEvent = await prisma.paymentEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `draft:${orderId}`,
      },
    },
  });
  if (
    !draftEvent ||
    draftEvent.paymentId !== initial.payment.id ||
    draftEvent.eventType !== "IPAYMU_VA_DRAFT"
  ) throw new Error("Catatan pilihan bank tidak ditemukan.");

  const draft = vaDraftSchema.parse(draftEvent.payload);
  if (draft.mode !== config.mode) throw new Error("Mode invoice berbeda dari konfigurasi.");
  const available = await selectVaBank(draft.bank);
  if (available.fee !== draft.fee) {
    throw new Error("Biaya bank berubah. Batalkan pesanan dan buat pesanan baru.");
  }

  const prepared = await transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: true, items: true },
    });
    if (
      !order?.payment || order.payment.provider !== "IPAYMU" ||
      order.status !== "PENDING" || order.payment.status !== "PENDING" ||
      order.payment.amount !== order.total
    ) throw new Error("Pesanan sudah berubah.");

    const minutes = Math.floor(
      (getUnpaidOrderDeadline(order.createdAt).getTime() - Date.now()) / 60000,
    );
    if (minutes < 1) throw new Error("Waktu pembayaran tidak cukup untuk membuat VA.");

    const expectedDraft = `ipaymu_draft:${draft.bank}:${order.id}`;
    if (order.payment.externalId !== expectedDraft) {
      throw new Error("Permintaan VA sudah diproses atau belum pasti. Jangan membuat VA ulang.");
    }

    const phone = (order.customerPhone ?? "").replace(/[\s()-]/g, "");
    if (!/^\+?[0-9]{8,15}$/.test(phone)) {
      throw new Error("Nomor HP untuk pembayaran VA tidak valid.");
    }

    const claimed = await tx.payment.updateMany({
      where: {
        id: order.payment.id,
        provider: "IPAYMU",
        status: "PENDING",
        externalId: expectedDraft,
        order: { is: { status: "PENDING" } },
      },
      data: { externalId: `ipaymu_creating:${draft.bank}:${order.id}` },
    });
    if (claimed.count !== 1) throw new Error("Permintaan VA sudah diproses.");

    await tx.paymentEvent.create({
      data: {
        paymentId: order.payment.id,
        provider: "IPAYMU",
        providerEventId: `create-request:${order.id}`,
        eventType: "IPAYMU_VA_CREATE_REQUESTED",
        payload: {
          referenceId: order.id,
          bank: draft.bank,
          amount: order.total,
          fee: draft.fee,
          mode: config.mode,
          feeDirection: "BUYER",
        },
      },
    });

    return { order, phone, minutes };
  });

  // Satu permintaan saja. Timeout tidak mengembalikan status menjadi draft.
  const data = await ipaymuRequest("POST", "/api/v2/payment/direct", {
    name: prepared.order.customerName,
    phone: prepared.phone,
    email: prepared.order.customerEmail,
    amount: prepared.order.total,
    referenceId: prepared.order.id,
    paymentMethod: "va",
    paymentChannel: draft.bank,
    feeDirection: "BUYER",
    notifyUrl: callbackUrl.toString(),
    expired: prepared.minutes,
    expiredType: "minutes",
    comments: `Pesanan ${prepared.order.orderNumber}`,
    product: prepared.order.items.map((item) => item.productName),
    qty: prepared.order.items.map((item) => item.quantity),
    price: prepared.order.items.map((item) => item.unitPrice),
  });

  const invoice = parseVaInvoice(data, {
    referenceId: orderId,
    bank: draft.bank,
    amount: prepared.order.total,
    fee: draft.fee,
  });

  await saveIpaymuInvoice(orderId, prepared.order.payment!.id, invoice);
  return invoice;
}
