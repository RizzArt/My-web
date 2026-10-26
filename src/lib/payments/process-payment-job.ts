import { fulfillPaidOrder } from "./paid-order-fulfillment";
import { autoCancelExpiredOrder } from "@/lib/customer-cancellation";
import { isUnpaidOrderExpired } from "@/lib/order-expiry";
import { verifySociaBuzzOrder } from "./sociabuzz-service";
import { verifyIpaymuOrder } from "./ipaymu-verification";

export type PaymentJob = {
  id: string;
  provider: string | null;
  externalId: string | null;
  status: string;
  order: {
    id: string;
    status: string;
    createdAt: Date;
    studioCreditTopUp?: { id: string } | null;
  };
};

export async function processPaymentJob(job: PaymentJob, now: Date) {
  if (job.status === "PAID" && job.order.status === "PAID") {
    await fulfillPaidOrder(job.order.id);
    return "delivery" as const;
  }

  const sociaBuzzActive = job.provider === "SOCIABUZZ" &&
    Boolean(job.externalId?.startsWith("scbz:"));
  const ipaymuActive = job.provider === "IPAYMU" &&
    /^ipaymu:[0-9]+$/.test(job.externalId ?? "");

  if (job.status === "CANCELLED" && job.order.status === "CANCELLED") {
    if (sociaBuzzActive) await verifySociaBuzzOrder(job.order.id);
    else if (ipaymuActive) await verifyIpaymuOrder(job.order.id);
    return "monitoring" as const;
  }

  if (job.status !== "PENDING" || job.order.status !== "PENDING") {
    return "skipped" as const;
  }

  if (sociaBuzzActive || ipaymuActive) {
    // Error gateway menghentikan proses ini sebelum pembatalan.
    const result = sociaBuzzActive
      ? await verifySociaBuzzOrder(job.order.id)
      : await verifyIpaymuOrder(job.order.id);
    if (result.status === "PAID") return "paid" as const;
    if (result.status !== "PENDING") return "verified" as const;
  }

  if (isUnpaidOrderExpired(job.order.createdAt, now)) {
    // Draft belum memiliki invoice. Permintaan VA yang belum pasti
    // mempertahankan externalId dan marker untuk pemulihan callback.
    const result = await autoCancelExpiredOrder(job.order.id, now);
    return result.status === "CANCELLED"
      ? "cancelled" as const : "skipped" as const;
  }

  return sociaBuzzActive || ipaymuActive
    ? "verified" as const : "skipped" as const;
}
