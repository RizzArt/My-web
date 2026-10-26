import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { Prisma, RefundMethod, RefundPayoutType, RefundStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, maskPayoutDestination } from "@/lib/security/secrets";
import { reverseOrderEarnings } from "@/lib/seller-finance";
import { markCreditedTopUpRefundForReview, markCreditedTopUpRefundForReviewTx } from "@/lib/studio/topups";
import { notifyAdmins } from "@/lib/admin-notifications";

export class StudioTopUpRefundReviewRequired extends Error { constructor() { super("Refund top up Studio Credit memerlukan peninjauan admin."); } }
export class StudioTopUpRefundBlocked extends Error { constructor() { super("Refund top up Studio Credit belum dapat diproses melalui refund produk biasa."); } }
async function notifyTopUpReview(topUpId: string | null) {
  if (topUpId) await notifyAdmins({ eventKey: `studio-topup-refund-review:${topUpId}`, title: "Refund Top Up Studio Credit Perlu Review", message: "Top up Studio Credit yang sudah dikreditkan memerlukan peninjauan manual.", link: "/admin/refunds" });
}
async function blockLegacyTopUpRefund(refundId: string, reason: string) {
  const refund = await prisma.refundRequest.findUnique({ where: { id: refundId }, select: { orderId: true, order: { select: { studioCreditTopUp: { select: { id: true } } } } } });
  if (!refund?.order.studioCreditTopUp) return;
  const review = await markCreditedTopUpRefundForReview(refund.orderId, reason);
  if (review.topUpId) await notifyTopUpReview(review.topUpId);
  throw new StudioTopUpRefundReviewRequired();
}

export const REFUND_WINDOW_HOURS = 24;

export function refundDeadline(completedAt: Date) {
  return new Date(completedAt.getTime() + REFUND_WINDOW_HOURS * 60 * 60 * 1000);
}

export function isRefundWindowOpen(completedAt: Date | null, now = new Date()) {
  return Boolean(completedAt && now.getTime() <= refundDeadline(completedAt).getTime());
}

export function normalizePayout(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function publicRefund(refund: {
  id: string; orderId: string; amount: number; method: RefundMethod; reason: string; status: RefundStatus;
  payoutType: RefundPayoutType | null; payoutProvider: string | null; payoutAccountName: string | null;
  createdAt: Date; reviewedAt: Date | null; adminNote: string | null; refundedAt: Date | null; transferReference: string | null;
  payoutAccountNumberEncrypted?: string | null;
}) {
  return {
    id: refund.id, orderId: refund.orderId, amount: refund.amount, method: refund.method, reason: refund.reason,
    status: refund.status, payoutType: refund.payoutType, payoutProvider: refund.payoutProvider,
    payoutAccountName: refund.payoutAccountName, payoutDestination: refund.payoutAccountNumberEncrypted ? maskPayoutDestination(decryptSecret(refund.payoutAccountNumberEncrypted)) : null,
    createdAt: refund.createdAt, reviewedAt: refund.reviewedAt, adminNote: refund.adminNote,
    refundedAt: refund.refundedAt, transferReference: refund.transferReference,
  };
}

function isRetryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function createRefundRequest(input: {
  orderId: string; userId: string; method: RefundMethod; reason: string;
  payoutType?: RefundPayoutType; payoutProvider?: string; payoutAccountNumber?: string; payoutAccountName?: string;
}, now = new Date()) {
  try {
    const result = await adminNotifiedTransaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: input.orderId, userId: input.userId }, select: { id: true, status: true, total: true, completedAt: true, refundRequest: { select: { id: true } }, studioCreditTopUp: { select: { id: true, creditedAt: true } } } });
      if (!order) throw new Error("Order tidak ditemukan.");
      if (order.studioCreditTopUp) return { review: await markCreditedTopUpRefundForReviewTx(tx, order.id, "CUSTOMER_REFUND_REQUEST"), refund: null };
      if (order.status !== "COMPLETED" || !order.completedAt) throw new Error("Refund hanya tersedia untuk order yang sudah selesai.");
      if (!isRefundWindowOpen(order.completedAt, now)) throw new Error("Batas waktu refund 24 jam telah lewat.");
      if (order.refundRequest) throw new Error("Order ini sudah memiliki pengajuan refund.");
      if (input.method === "MANUAL_TRANSFER" && (!input.payoutType || !input.payoutProvider || !input.payoutAccountNumber || !input.payoutAccountName)) throw new Error("Data rekening atau e-wallet wajib diisi.");
      const refund = await tx.refundRequest.create({ data: {
        orderId: order.id, userId: input.userId, amount: order.total, method: input.method, reason: input.reason,
        payoutType: input.method === "MANUAL_TRANSFER" ? input.payoutType : null,
        payoutProvider: input.method === "MANUAL_TRANSFER" ? normalizePayout(input.payoutProvider ?? "") : null,
        payoutAccountNumberEncrypted: input.method === "MANUAL_TRANSFER" ? encryptSecret(normalizePayout(input.payoutAccountNumber ?? "")) : null,
        payoutAccountName: input.method === "MANUAL_TRANSFER" ? normalizePayout(input.payoutAccountName ?? "") : null,
      } });
      return { review: null, refund };
    }, (result) => result.refund ? ({
      eventKey: `refund-request:${result.refund.id}`,
      title: "Pengajuan Refund Baru",
      message: "Ada pengajuan refund yang menunggu peninjauan.",
      link: `/admin/refunds/${result.refund.id}`
    }) : null, { isolationLevel: "Serializable" });
    if (result.review) {
      if (result.review.topUpId) { await notifyTopUpReview(result.review.topUpId); throw new StudioTopUpRefundReviewRequired(); }
      throw new StudioTopUpRefundBlocked();
    }
    if (!result.refund) throw new Error("Refund tidak dapat dibuat.");
    return result.refund;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("Order ini sudah memiliki pengajuan refund.");
    throw error;
  }
}

export async function approveRefund(refundId: string, adminId: string, adminNote?: string) {
  await blockLegacyTopUpRefund(refundId, "ADMIN_REFUND_APPROVE");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const refund = await tx.refundRequest.findUnique({ where: { id: refundId }, include: { order: { select: { orderNumber: true } } } });
        if (!refund) throw new Error("Refund tidak ditemukan.");
        const claimed = await tx.refundRequest.updateMany({ where: { id: refundId, status: "PENDING" }, data: { status: refund.method === "ACCOUNT_BALANCE" ? "REFUNDED" : "APPROVED", reviewedAt: new Date(), reviewedById: adminId, adminNote: adminNote || null, refundedAt: refund.method === "ACCOUNT_BALANCE" ? new Date() : null } });
        if (claimed.count !== 1) throw new Error("Refund sudah diproses.");
        if (refund.method === "MANUAL_TRANSFER") return tx.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: refund.userId }, select: { balance: true } });
        const balanceAfter = user.balance + refund.amount;
        await tx.user.update({ where: { id: refund.userId }, data: { balance: balanceAfter } });
        await tx.walletTransaction.create({ data: { userId: refund.userId, type: "REFUND_CREDIT", amount: refund.amount, balanceBefore: user.balance, balanceAfter, referenceType: "RefundRequest", referenceId: refund.id, refundRequestId: refund.id, description: `Refund order ${refund.orderId}` } });
        await reverseOrderEarnings(tx, refund.orderId, `Refund Pesanan #${refund.order.orderNumber}`);
        return tx.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isRetryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Refund tidak dapat diproses.");
}

export async function rejectRefund(refundId: string, adminId: string, adminNote: string) {
  return prisma.refundRequest.updateMany({ where: { id: refundId, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: adminId, adminNote } }).then((result) => {
    if (result.count !== 1) throw new Error("Refund tidak ditemukan atau sudah diproses.");
    return prisma.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  });
}

export async function markRefunded(refundId: string, adminNote?: string, transferReference?: string) {
  await blockLegacyTopUpRefund(refundId, "ADMIN_REFUND_MARK_REFUNDED");
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refundRequest.findUnique({ where: { id: refundId }, include: { order: { select: { orderNumber: true } } } });
    if (!refund || refund.method !== "MANUAL_TRANSFER" || refund.status !== "APPROVED") throw new Error("Refund manual tidak tersedia atau sudah diproses.");
    await tx.refundRequest.update({ where: { id: refundId }, data: { status: "REFUNDED", refundedAt: new Date(), adminNote: adminNote || undefined, transferReference: transferReference || null } });
    await reverseOrderEarnings(tx, refund.orderId, `Refund Pesanan #${refund.order.orderNumber}`);
    return tx.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  }, { isolationLevel: "Serializable" });
}

export async function reconcileRefundSellerEarnings(refundId: string) {
  await blockLegacyTopUpRefund(refundId, "REFUND_RECONCILIATION");
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refundRequest.findUnique({ where: { id: refundId }, include: { order: { select: { orderNumber: true } } } });
    if (!refund || refund.status !== "REFUNDED") throw new Error("Refund belum berstatus REFUNDED.");
    const reversed = await reverseOrderEarnings(tx, refund.orderId, `Refund Pesanan #${refund.order.orderNumber}`);
    return { refundId, orderId: refund.orderId, reversed };
  }, { isolationLevel: "Serializable" });
}

// Manual refunds may transition only from status: "APPROVED".
