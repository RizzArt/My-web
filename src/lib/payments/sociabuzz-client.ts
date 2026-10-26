import { createHash } from "node:crypto";
import { z } from "zod";

export type SociaBuzzOrder = {
  orderId: string;
  orderNumber: string;
  amount: number;
};

export function sociaBuzzSessionId(orderId: string) {
  return createHash("sha256").update(orderId).digest("hex");
}

const responseSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  orderId: z.string().min(1),
  orderNumber: z.string().startsWith("KS-"),
  amount: z.number().int().positive(),
  currency: z.literal("IDR"),
  invoiceId: z.string().regex(/^TRIBE-IDR-[A-Za-z0-9-]+$/),
  method: z.string().min(1),
  qrCode: z.string().min(1).max(20000),
  totalPay: z.union([z.string(), z.number()]),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(["pending", "paid", "expired", "failed"]),
});

export function validateSociaBuzzResponse(
  value: unknown,
  expected: SociaBuzzOrder,
) {
  const parsed = responseSchema.parse(value);
  if (
    parsed.id !== sociaBuzzSessionId(expected.orderId) ||
    parsed.orderId !== expected.orderId ||
    parsed.orderNumber !== expected.orderNumber ||
    parsed.amount !== expected.amount
  ) {
    throw new Error("Identitas atau nominal invoice tidak sesuai pesanan.");
  }

  const totalText = String(parsed.totalPay);
  if (!/^\d+(?:\.0+)?$/.test(totalText)) {
    throw new Error("Format total pembayaran tidak valid.");
  }
  const totalPay = Number(totalText);
  if (!Number.isSafeInteger(totalPay) || totalPay < expected.amount) {
    throw new Error("Total pembayaran tidak valid.");
  }

  return { ...parsed, totalPay };
}

function configuration() {
  const baseUrl = process.env.SCBZ_GATEWAY_URL;
  const key = process.env.SCBZ_GATEWAY_KEY;
  if (baseUrl !== "http://127.0.0.1:8011" || !key || key.length < 32) {
    throw new Error("Gateway SociaBuzz belum dikonfigurasi.");
  }
  return { baseUrl, key };
}

async function callGateway(
  action: "create" | "status",
  body: Record<string, unknown>,
  expected: SociaBuzzOrder,
) {
  const { baseUrl, key } = configuration();
  const response = await fetch(`${baseUrl}/v1/payments/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(100000),
  });

  if (!response.ok) {
    if (response.status === 422) {
      throw new Error("Nominal SociaBuzz tidak sesuai total pesanan.");
    }
    throw new Error("Gateway pembayaran belum dapat memproses permintaan.");
  }
  return validateSociaBuzzResponse(await response.json(), expected);
}

export function createSociaBuzzQr(
  order: SociaBuzzOrder & { name: string; email: string },
) {
  return callGateway("create", {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    amount: order.amount,
    name: order.name,
    email: order.email,
  }, order);
}

export function checkSociaBuzzPayment(order: SociaBuzzOrder) {
  return callGateway("status", {
    id: sociaBuzzSessionId(order.orderId),
  }, order);
}
