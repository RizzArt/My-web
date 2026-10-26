import { RefundStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ADMIN_REFUND_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REFUNDED"] as const;
export type AdminRefundStatus = (typeof ADMIN_REFUND_STATUSES)[number];

export function parseAdminRefundStatus(value: string | null | undefined): AdminRefundStatus | undefined {
  return ADMIN_REFUND_STATUSES.includes(value as AdminRefundStatus) ? value as AdminRefundStatus : undefined;
}

export function adminRefundWhere(status?: AdminRefundStatus) {
  return status ? { status: status as RefundStatus } : undefined;
}

export async function findAdminRefunds(status?: AdminRefundStatus) {
  return prisma.refundRequest.findMany({
    where: adminRefundWhere(status),
    orderBy: { createdAt: "desc" },
    include: {
      order: { select: { orderNumber: true, items: { select: { productName: true } } } },
      user: { select: { name: true, email: true } },
    },
  });
}
