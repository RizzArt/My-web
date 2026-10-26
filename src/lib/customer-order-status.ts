export const customerOrderStatuses = ["WAITING_PAYMENT", "PROCESSING", "WAITING_CONFIRMATION", "COMPLETED", "REFUNDED", "CANCELLED", "FAILED"] as const;
export type CustomerOrderDisplayStatus = (typeof customerOrderStatuses)[number];

type CustomerOrder = {
  status?: string | null;
  payment?: { status?: string | null } | null;
  items?: Array<{ quantity?: number | null }>;
  deliveries?: Array<{ status?: string | null; autoAcceptAt?: Date | string | null }>;
  refundRequest?: { status?: string | null } | null;
};

export function getCustomerOrderDisplayStatus(order: CustomerOrder): CustomerOrderDisplayStatus {
  const orderStatus = order.status?.toUpperCase();
  const paymentStatus = order.payment?.status?.toUpperCase();
  if (order.refundRequest?.status === "REFUNDED") return "REFUNDED";

  if (["CANCELLED"].includes(orderStatus ?? "") || ["CANCELLED"].includes(paymentStatus ?? "")) return "CANCELLED";
  if (["EXPIRED"].includes(orderStatus ?? "") || ["EXPIRED"].includes(paymentStatus ?? "")) return "FAILED";
  if (["FAILED", "REFUNDED"].includes(orderStatus ?? "") || ["FAILED", "REFUNDED"].includes(paymentStatus ?? "")) return "FAILED";
  if (orderStatus === "PENDING" || paymentStatus === "PENDING" || (paymentStatus && paymentStatus !== "PAID")) return "WAITING_PAYMENT";

  const expectedDeliveries = (order.items ?? []).reduce((total, item) => total + Math.max(0, item.quantity ?? 0), 0);
  const deliveredCount = (order.deliveries ?? []).filter((delivery) => delivery.status === "DELIVERED").length;
  if (expectedDeliveries > 0 && deliveredCount >= expectedDeliveries && (order.deliveries ?? []).length >= expectedDeliveries) return "COMPLETED";
  if ((order.deliveries ?? []).some((delivery) => delivery.status === "AWAITING_CONFIRMATION")) return "WAITING_CONFIRMATION";
  return "PROCESSING";
}

export const customerOrderStatusLabels: Record<CustomerOrderDisplayStatus, string> = {
  WAITING_PAYMENT: "Menunggu Pembayaran",
  PROCESSING: "Proses Pengiriman",
  WAITING_CONFIRMATION: "Menunggu Konfirmasi",
  COMPLETED: "Selesai",
  REFUNDED: "REFUNDED",
  CANCELLED: "Dibatalkan",
  FAILED: "Gagal",
};

export function getCustomerOrderDisplayLabel(order: CustomerOrder): string {
  const status = getCustomerOrderDisplayStatus(order);
  if (status === "FAILED" && (order.status === "EXPIRED" || order.payment?.status === "EXPIRED")) return "Kedaluwarsa";
  return customerOrderStatusLabels[status];
}

export const customerOrderStatusBadgeClasses: Record<CustomerOrderDisplayStatus, string> = {
  WAITING_PAYMENT: "bg-amber-100 text-amber-900",
  PROCESSING: "bg-sand text-ink",
  WAITING_CONFIRMATION: "bg-coral/15 text-coral",
  COMPLETED: "bg-mint text-ink",
  REFUNDED: "bg-mint text-ink",
  CANCELLED: "bg-red-50 text-red-700",
  FAILED: "bg-red-50 text-red-700",
};
