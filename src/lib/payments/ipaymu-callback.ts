import { prisma } from "@/lib/prisma";
import { ipaymuConfig, ipaymuRequest } from "./ipaymu-client";
import { parseIpaymuCallbackIdentity } from "./ipaymu-callback-data";
import { parseVaEvidence, vaDraftSchema } from "./ipaymu-validation";
import { saveIpaymuInvoice } from "./ipaymu-record";
import { verifyIpaymuOrder } from "./ipaymu-verification";

export async function processIpaymuCallback(
  payload: Record<string, unknown>,
) {
  const config = ipaymuConfig();
  const identity = parseIpaymuCallbackIdentity(
    payload, config.va, config.mode,
  );
  const order = await prisma.order.findUnique({
    where: { id: identity.referenceId },
    include: { payment: true },
  });
  if (!order?.payment || order.payment.provider !== "IPAYMU") {
    throw new Error("Pesanan callback VA tidak ditemukan.");
  }

  const [draftEvent, requestedEvent] = await Promise.all([
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `draft:${order.id}`,
      } },
    }),
    prisma.paymentEvent.findUnique({
      where: { provider_providerEventId: {
        provider: "IPAYMU", providerEventId: `create-request:${order.id}`,
      } },
    }),
  ]);

  if (
    !draftEvent || !requestedEvent ||
    draftEvent.paymentId !== order.payment.id ||
    requestedEvent.paymentId !== order.payment.id ||
    draftEvent.eventType !== "IPAYMU_VA_DRAFT" ||
    requestedEvent.eventType !== "IPAYMU_VA_CREATE_REQUESTED"
  ) throw new Error("Permintaan pembuatan VA tidak ditemukan.");

  const draft = vaDraftSchema.parse(draftEvent.payload);
  const requested = requestedEvent.payload as unknown as {
    referenceId?: string; bank?: string; amount?: number;
    fee?: number; mode?: string; feeDirection?: string;
  };
  const activeId = `ipaymu:${identity.transactionId}`;
  const creatingId = `ipaymu_creating:${draft.bank}:${order.id}`;

  if (
    draft.mode !== config.mode || draft.bank !== identity.bank ||
    requested.referenceId !== order.id ||
    requested.bank !== draft.bank ||
    requested.amount !== order.total ||
    requested.fee !== draft.fee ||
    requested.mode !== config.mode ||
    requested.feeDirection !== "BUYER" ||
    order.payment.amount !== order.total ||
    ![creatingId, activeId].includes(order.payment.externalId ?? "")
  ) throw new Error("Callback tidak cocok dengan permintaan VA.");

  // Verifikasi API wajib sebelum mengikat ID invoice dari callback.
  parseVaEvidence(
    await ipaymuRequest("POST", "/api/v2/transaction", {
      transactionId: identity.transactionId,
    }),
    {
      transactionId: identity.transactionId,
      referenceId: order.id,
      amount: order.total,
      fee: draft.fee,
    },
  );

  await saveIpaymuInvoice(order.id, order.payment.id, {
    transactionId: identity.transactionId,
    referenceId: order.id,
    bank: draft.bank,
    bankName: draft.bankName,
    paymentNo: identity.paymentNo,
    amount: order.total,
    fee: draft.fee,
    total: order.total + draft.fee,
    gatewayExpiry: identity.gatewayExpiry,
  });

  // Jalur bersama menangani pembayaran dan kredit terlambat secara idempotent.
  return verifyIpaymuOrder(order.id);
}
