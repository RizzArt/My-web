import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUnpaidOrderDeadline } from "@/lib/order-expiry";
import { vaDraftSchema } from "./ipaymu-validation";

const storedInvoice = z.object({
  transactionId: z.string().regex(/^[0-9]+$/),
  referenceId: z.string(),
  bank: z.string(),
  paymentNo: z.string().regex(/^[0-9]{1,64}$/),
  amount: z.number().int().nonnegative(),
  fee: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export async function readIpaymuPaymentView(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId }, include: { payment: true },
  });
  if (!order?.payment || order.payment.provider !== "IPAYMU") {
    throw new Error("Pesanan VA tidak ditemukan.");
  }

  const [draftEvent, invoiceEvent] = await Promise.all([
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `draft:${orderId}`,
      } },
    }),
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `invoice:${orderId}`,
      } },
    }),
  ]);
  if (
    !draftEvent || draftEvent.paymentId !== order.payment.id ||
    draftEvent.eventType !== "IPAYMU_VA_DRAFT"
  ) throw new Error("Pilihan bank tidak ditemukan.");
  const draft = vaDraftSchema.parse(draftEvent.payload);
  const deadlineAt = getUnpaidOrderDeadline(order.createdAt).getTime();
  const open = order.status === "PENDING" &&
    order.payment.status === "PENDING" && Date.now() < deadlineAt;

  let invoice: { paymentNo: string } | null = null;
  if (invoiceEvent) {
    const saved = storedInvoice.parse(invoiceEvent.payload);
    if (
      invoiceEvent.paymentId !== order.payment.id ||
      invoiceEvent.eventType !== "IPAYMU_VA_CREATED" ||
      saved.referenceId !== orderId ||
      saved.bank !== draft.bank ||
      saved.amount !== order.total ||
      saved.fee !== draft.fee ||
      saved.total !== order.total + draft.fee ||
      order.payment.externalId !== `ipaymu:${saved.transactionId}`
    ) throw new Error("Catatan invoice tidak sesuai.");
    if (open) invoice = { paymentNo: saved.paymentNo };
  }

  const externalId = order.payment.externalId ?? "";
  const phase = invoiceEvent ? "active" :
    externalId === `ipaymu_draft:${draft.bank}:${orderId}` ? "draft" :
    "creating";

  return {
    status: order.payment.status,
    orderStatus: order.status,
    phase,
    bankName: draft.bankName,
    amount: order.total,
    fee: draft.fee,
    total: order.total + draft.fee,
    deadlineAt,
    open,
    enabled: process.env.IPAYMU_ENABLED === "true",
    invoice,
  };
}
