import type { OrderStatus, PaymentStatus, RefundStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SITE_NAME } from "@/lib/site";

export type ReceiptViewer = { id: string; role: Role };

type ReceiptOrder = {
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  subtotal: number;
  total: number;
  createdAt: Date;
  payment: {
    status: PaymentStatus;
    provider: string | null;
    externalId: string | null;
    amount: number;
    paidAt: Date | null;
  } | null;
  items: Array<{ productName: string; unitPrice: number; quantity: number }>;
  studioCreditTopUp: { packageName: string; price: number; credits: number } | null;
  refundRequest: {
    status: RefundStatus;
    amount: number;
    refundedAt: Date | null;
  } | null;
};

type ReceiptStore = {
  storeName: string;
  supportEmail: string | null;
  storeEmail: string | null;
  whatsapp: string | null;
  timezone: string;
} | null;

export type PurchaseReceipt = {
  orderNumber: string;
  buyer: { name: string; email: string };
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  paidAt: Date;
  items: Array<{ name: string; unitPrice: number; quantity: number; subtotal: number }>;
  subtotal: number;
  discount: number;
  serviceFee: number;
  tax: number;
  totalPaid: number;
  orderTotal: number;
  hasLedgerMismatch: boolean;
  paymentMethod: string;
  paymentReference: string | null;
  refund: { status: RefundStatus; amount: number; refundedAt: Date | null; netPaid: number } | null;
  store: { name: string; supportEmail: string | null; whatsapp: string | null; timezone: string };
};

export class ReceiptAuthenticationError extends Error {
  constructor() {
    super("Login diperlukan untuk melihat struk.");
  }
}

const receiptStoreSelect = {
  storeName: true,
  supportEmail: true,
  storeEmail: true,
  whatsapp: true,
  timezone: true,
} as const;

const receiptOrderSelect = {
  orderNumber: true,
  userId: true,
  customerName: true,
  customerEmail: true,
  status: true,
  subtotal: true,
  total: true,
  createdAt: true,
  payment: {
    select: {
      status: true,
      provider: true,
      externalId: true,
      amount: true,
      paidAt: true,
    },
  },
  items: {
    select: {
      productName: true,
      unitPrice: true,
      quantity: true,
    },
    orderBy: { id: "asc" as const },
  },
  studioCreditTopUp: { select: { packageName: true, price: true, credits: true } },
  refundRequest: {
    select: {
      status: true,
      amount: true,
      refundedAt: true,
    },
  },
} as const;

export function canViewReceipt(
  paymentStatus: PaymentStatus | null | undefined,
  orderStatus: OrderStatus,
  refundStatus: RefundStatus | null | undefined,
) {
  if (paymentStatus === "REFUNDED" || refundStatus === "REFUNDED") return true;
  return paymentStatus === "PAID" && orderStatus !== "CANCELLED" && orderStatus !== "EXPIRED";
}

function paymentMethodLabel(provider: string | null) {
  const labels: Record<string, string> = {
    IPAYMU: "iPaymu",
    MIDTRANS: "Midtrans",
    PAYPAL: "PayPal",
    SOCIABUZZ: "SociaBuzz",
    QRIS_MANUAL: "QRIS",
    WALLET: "Saldo akun",
    MANUAL: "Pembayaran manual",
  };
  return provider && labels[provider] ? labels[provider] : "Pembayaran digital";
}

function safePaymentReference(value: string | null) {
  if (!value || value.length > 120) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

function resolvedStore(store: ReceiptStore) {
  return {
    name: store?.storeName?.trim() || SITE_NAME,
    supportEmail: store?.supportEmail?.trim() || store?.storeEmail?.trim() || null,
    whatsapp: store?.whatsapp?.trim() || null,
    timezone: store?.timezone?.trim() || "Asia/Jakarta",
  };
}

export function buildPurchaseReceipt(order: ReceiptOrder, store: ReceiptStore): PurchaseReceipt | null {
  if (!order.payment || !canViewReceipt(order.payment.status, order.status, order.refundRequest?.status)) return null;

  const items = order.studioCreditTopUp ? [{
    name: `Top Up ${order.studioCreditTopUp.packageName}`,
    unitPrice: order.studioCreditTopUp.price,
    quantity: 1,
    subtotal: order.studioCreditTopUp.price,
  }] : order.items.map((item) => ({
    name: item.productName,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    subtotal: item.unitPrice * item.quantity,
  }));
  const itemSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  // Payment.amount is the verified amount. The order ledger remains visible as
  // a consistency signal, but is never silently substituted for it.
  const totalPaid = order.payment.amount;
  const adjustment = totalPaid - itemSubtotal;
  const discount = adjustment < 0 ? Math.abs(adjustment) : 0;
  const serviceFee = adjustment > 0 ? adjustment : 0;
  const refund = order.refundRequest?.status === "REFUNDED" || order.payment.status === "REFUNDED"
    ? {
      status: order.refundRequest?.status ?? "REFUNDED",
      amount: order.refundRequest?.amount ?? totalPaid,
      refundedAt: order.refundRequest?.refundedAt ?? order.payment.paidAt,
      netPaid: Math.max(0, totalPaid - (order.refundRequest?.amount ?? totalPaid)),
    }
    : null;

  return {
    orderNumber: order.orderNumber,
    buyer: { name: order.customerName || "Pembeli", email: order.customerEmail },
    orderStatus: order.status,
    paymentStatus: order.payment.status,
    paidAt: order.payment.paidAt ?? order.createdAt,
    items,
    subtotal: itemSubtotal,
    discount,
    serviceFee,
    tax: 0,
    totalPaid,
    orderTotal: order.total,
    hasLedgerMismatch: order.subtotal !== itemSubtotal || order.total !== totalPaid,
    paymentMethod: paymentMethodLabel(order.payment.provider),
    paymentReference: safePaymentReference(order.payment.externalId),
    refund,
    store: resolvedStore(store),
  };
}

export async function getPurchaseReceipt(orderNumber: string, viewer: ReceiptViewer | null) {
  if (!viewer) throw new ReceiptAuthenticationError();

  const where = viewer.role === "ADMIN" ? { orderNumber } : { orderNumber, userId: viewer.id };
  const [order, store] = await Promise.all([
    prisma.order.findFirst({ where, select: receiptOrderSelect }),
    prisma.storeSetting.findUnique({ where: { id: "default" }, select: receiptStoreSelect }),
  ]);
  return order ? buildPurchaseReceipt(order, store) : null;
}

export function formatReceiptCurrency(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatReceiptDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}
