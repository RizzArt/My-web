import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { VaInvoice } from "./ipaymu-validation";

export async function saveIpaymuInvoice(
  orderId: string,
  paymentId: string,
  invoice: VaInvoice,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { order: true },
        });
        const activeId = `ipaymu:${invoice.transactionId}`;
        const creatingId = `ipaymu_creating:${invoice.bank}:${orderId}`;

        if (
          !payment || payment.provider !== "IPAYMU" ||
          payment.orderId !== orderId ||
          invoice.referenceId !== orderId ||
          payment.amount !== invoice.amount ||
          payment.order.total !== invoice.amount ||
          invoice.total !== invoice.amount + invoice.fee ||
          ![creatingId, activeId].includes(payment.externalId ?? "")
        ) throw new Error("Identitas invoice VA tidak sesuai.");

        const existing = await tx.paymentEvent.findUnique({
          where: { provider_providerEventId: {
            provider: "IPAYMU",
            providerEventId: `invoice:${orderId}`,
          } },
        });

        if (existing) {
          const saved = existing.payload as unknown as VaInvoice;
          if (
            existing.paymentId !== paymentId ||
            existing.eventType !== "IPAYMU_VA_CREATED" ||
            saved.transactionId !== invoice.transactionId ||
            saved.referenceId !== orderId ||
            saved.bank !== invoice.bank ||
            saved.paymentNo !== invoice.paymentNo ||
            saved.amount !== invoice.amount ||
            saved.fee !== invoice.fee ||
            saved.total !== invoice.total ||
            payment.externalId !== activeId
          ) throw new Error("Catatan invoice VA bertentangan.");
          return;
        }

        const claimed = await tx.payment.updateMany({
          where: {
            id: paymentId,
            provider: "IPAYMU",
            externalId: payment.externalId,
          },
          // Pertahankan status apabila order sudah dibatalkan.
          data: { externalId: activeId },
        });
        if (claimed.count !== 1) throw new Error("Invoice VA sudah berubah.");

        await tx.paymentEvent.create({
          data: {
            paymentId,
            provider: "IPAYMU",
            providerEventId: `invoice:${orderId}`,
            eventType: "IPAYMU_VA_CREATED",
            payload: invoice as unknown as Prisma.InputJsonValue,
          },
        });
      }, { isolationLevel: "Serializable" });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (["P2034", "P2002"].includes(code) && attempt < 2) continue;
      throw error;
    }
  }
}
