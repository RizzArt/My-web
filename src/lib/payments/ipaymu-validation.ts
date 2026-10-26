import { z } from "zod";

const money = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const vaDraftSchema = z.object({
  bank: z.string().regex(/^[a-z0-9_]+$/),
  bankName: z.string().min(1),
  fee: money,
  feeDirection: z.literal("BUYER"),
  mode: z.enum(["sandbox", "production"]),
});

export type VaInvoice = {
  transactionId: string;
  referenceId: string;
  bank: string;
  bankName: string;
  paymentNo: string;
  amount: number;
  fee: number;
  total: number;
  gatewayExpiry: string;
};


function normalizeIpaymuInvoice(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const row = data as Record<string, unknown>;
  return {
    ...row,
    Via: typeof row.Via === "string" ? row.Via.trim().toLowerCase() : row.Via,
    Channel: typeof row.Channel === "string" ? row.Channel.trim().toLowerCase() : row.Channel,
  };
}

export function parseVaInvoice(
  data: unknown,
  expected: { referenceId: string; bank: string; amount: number; fee: number },
): VaInvoice {
  const parsed = z.object({
    TransactionId: z.union([z.string(), z.number()])
      .transform(String).pipe(z.string().regex(/^[0-9]+$/)),
    ReferenceId: z.string().min(1),
    Via: z.literal("va"),
    Channel: z.string(),
    PaymentNo: z.string().regex(/^[0-9]+$/),
    PaymentName: z.string().min(1),
    Total: money,
    Fee: money,
    Expired: z.string().min(1),
  }).parse(normalizeIpaymuInvoice(data));

  if (
    parsed.ReferenceId !== expected.referenceId ||
    parsed.Channel !== expected.bank ||
    parsed.Fee !== expected.fee ||
    parsed.Total !== expected.amount + expected.fee
  ) throw new Error("Identitas atau nominal VA berbeda dari pesanan.");

  return {
    transactionId: parsed.TransactionId,
    referenceId: parsed.ReferenceId,
    bank: parsed.Channel,
    bankName: parsed.PaymentName,
    paymentNo: parsed.PaymentNo,
    amount: expected.amount,
    fee: parsed.Fee,
    total: parsed.Total,
    gatewayExpiry: parsed.Expired,
  };
}

export function parseVaEvidence(
  data: unknown,
  expected: {
    transactionId: string;
    referenceId: string;
    amount: number;
    fee: number;
  },
) {
  const result = z.object({
    TransactionId: z.union([z.string(), z.number()]).transform(String),
    ReferenceId: z.string(),
    Amount: money,
    Fee: money,
    Status: z.coerce.number().int(),
  }).parse(data);

  if (
    result.TransactionId !== expected.transactionId ||
    result.ReferenceId !== expected.referenceId ||
    result.Fee !== expected.fee ||
    ![expected.amount, expected.amount + expected.fee].includes(result.Amount)
  ) throw new Error("Bukti pembayaran VA tidak cocok.");

  if (![0, 1, 2, 4, 5, 6, -2].includes(result.Status)) {
    throw new Error("Status transaksi iPaymu perlu ditinjau admin.");
  }
  return { paid: [1, 6].includes(result.Status), gatewayStatus: result.Status };
}
