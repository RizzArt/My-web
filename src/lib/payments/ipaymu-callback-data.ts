import { z } from "zod";
import type { IpaymuMode } from "./ipaymu-client";

const schema = z.object({
  trx_id: z.union([z.string(), z.number()]),
  reference_id: z.string().min(1).max(100).optional(),
  referenceId: z.string().min(1).max(100).optional(),
  merchant: z.string(),
  via: z.literal("va"),
  channel: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  payment_no: z.string().regex(/^[0-9]{1,64}$/),
  va: z.string().optional(),
  is_sandbox: z.union([z.string(), z.boolean()]),
  expired_at: z.string().max(100).optional(),
});

export function parseIpaymuCallbackIdentity(
  payload: Record<string, unknown>,
  merchantVa: string,
  mode: IpaymuMode,
) {
  const data = schema.parse(payload);
  const transactionId = String(data.trx_id);
  const referenceId = data.reference_id ?? data.referenceId;
  if (
    !/^[0-9]+$/.test(transactionId) || !referenceId ||
    data.merchant !== merchantVa ||
    String(data.is_sandbox) !== String(mode === "sandbox") ||
    (data.reference_id && data.referenceId &&
      data.reference_id !== data.referenceId) ||
    (data.va !== undefined && data.va !== data.payment_no)
  ) throw new Error("Identitas callback iPaymu tidak sesuai.");

  return {
    transactionId,
    referenceId,
    bank: data.channel,
    paymentNo: data.payment_no,
    gatewayExpiry: data.expired_at ?? "",
  };
}
