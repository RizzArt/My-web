import { Prisma, SellerEarningStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export const financePeriods = ["today", "7d", "30d", "month", "all"] as const;
export type FinancePeriod = (typeof financePeriods)[number];

export function formatFinanceDate(date: Date | null, timezone = "Asia/Jakarta") {
  return date ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date) : null;
}

export type FinanceEarningRow = { sellerId: string | null; paid: boolean; status?: "PENDING" | "AVAILABLE" | "REVERSED" | "PAID_OUT"; grossAmount: number; platformFee: number; netAmount: number };
export type FinanceWithdrawalRow = { status: "PENDING" | "APPROVED" | "REJECTED" | "PAID"; amount: number };

type SellerBalanceLedgerRow = { type: string; amount: number; referenceType: string; referenceId: string };
type SellerBalanceEarningRow = { id: string; status: SellerEarningStatus };
type SellerEarningAmountRow = { status: SellerEarningStatus; netAmount: number };

export function sumFinanceEarnings(rows: FinanceEarningRow[]) {
  return rows.filter((row) => row.sellerId !== null && row.paid && row.status !== "REVERSED").reduce((sum, row) => ({ grossAmount: sum.grossAmount + row.grossAmount, platformFee: sum.platformFee + row.platformFee, netAmount: sum.netAmount + row.netAmount }), { grossAmount: 0, platformFee: 0, netAmount: 0 });
}

export function sumWithdrawals(rows: FinanceWithdrawalRow[]) {
  return { pending: rows.filter((row) => row.status === "PENDING" || row.status === "APPROVED").reduce((sum, row) => sum + row.amount, 0), paid: rows.filter((row) => row.status === "PAID").reduce((sum, row) => sum + row.amount, 0) };
}

export function sumSellerAvailableBalance(ledger: SellerBalanceLedgerRow[], earnings: SellerBalanceEarningRow[]) {
  const earningStatuses = new Map(earnings.map((earning) => [earning.id, earning.status]));
  const balanceTypes = new Set(["WITHDRAW_RELEASED", "WITHDRAW_RESERVED", "WITHDRAW_PAID", "PROMOTION_RESERVED", "PROMOTION_RELEASED", "PROMOTION_CHARGED"]);
  return ledger.filter((transaction) => {
    if (balanceTypes.has(transaction.type)) return true;
    if (transaction.type !== "SALE_AVAILABLE" || transaction.referenceType !== "SellerEarning") return false;
    const status = earningStatuses.get(transaction.referenceId);
    return status === SellerEarningStatus.AVAILABLE || status === SellerEarningStatus.PAID_OUT;
  }).reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function sumSellerPendingBalance(earnings: SellerEarningAmountRow[]) {
  return earnings.filter((earning) => earning.status === SellerEarningStatus.PENDING).reduce((sum, earning) => sum + earning.netAmount, 0);
}

export function sumSellerLifetimeEarnings(earnings: SellerEarningAmountRow[]) {
  return earnings.filter((earning) => earning.status !== SellerEarningStatus.REVERSED).reduce((sum, earning) => sum + earning.netAmount, 0);
}

export function financeDateRange(period: string | undefined, now = new Date()) {
  const selected = financePeriods.includes(period as FinancePeriod) ? period as FinancePeriod : "30d";
  const end = new Date(now);
  let start: Date | undefined;
  if (selected === "today") start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  if (selected === "7d") start = new Date(end.getTime() - 7 * 86400000);
  if (selected === "30d") start = new Date(end.getTime() - 30 * 86400000);
  if (selected === "month") start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { selected, start, end };
}

const paidSellerEarningWhere = (sellerId?: string, range?: { start?: Date; end: Date }): Prisma.SellerEarningWhereInput => ({
  ...(sellerId ? { sellerId } : {}),
  status: { not: "REVERSED" },
  order: { payment: { is: { status: "PAID" } }, ...(range?.start || range?.end ? { createdAt: { ...(range.start ? { gte: range.start } : {}), ...(range.end ? { lte: range.end } : {}) } } : {}) },
});

export async function financeAggregate(sellerId: string | undefined, period = "30d") {
  const range = financeDateRange(period);
  const result = await prisma.sellerEarning.aggregate({
    where: paidSellerEarningWhere(sellerId, range),
    _sum: { grossAmount: true, platformFee: true, netAmount: true },
  });
  const withdrawals = await prisma.withdrawal.aggregate({
    where: { ...(sellerId ? { sellerId } : {}), status: { in: ["PENDING", "APPROVED"] }, createdAt: { gte: range.start, lte: range.end } },
    _sum: { amount: true },
  });
  const paidWithdrawals = await prisma.withdrawal.aggregate({
    where: { ...(sellerId ? { sellerId } : {}), status: "PAID", createdAt: { gte: range.start, lte: range.end } },
    _sum: { amount: true },
  });
  const promotionRevenue = await prisma.promotion.aggregate({
    where: { ...(sellerId ? { sellerId } : {}), status: { in: ["ACTIVE", "COMPLETED"] }, approvedAt: { gte: range.start, lte: range.end } },
    _sum: { price: true },
  });
  return {
    period: range.selected,
    grossSales: result._sum.grossAmount ?? 0,
    platformFee: result._sum.platformFee ?? 0,
    sellerEarnings: result._sum.netAmount ?? 0,
    pendingWithdrawals: withdrawals._sum.amount ?? 0,
    paidWithdrawals: paidWithdrawals._sum.amount ?? 0,
    promotionRevenue: promotionRevenue._sum.price ?? 0,
  };
}

export async function topSellers(period = "30d") {
  const range = financeDateRange(period);
  const rows = await prisma.sellerEarning.groupBy({
    by: ["sellerId"],
    where: paidSellerEarningWhere(undefined, range),
    _sum: { grossAmount: true, platformFee: true, netAmount: true },
    _count: { orderId: true },
    orderBy: { _sum: { grossAmount: "desc" } },
    take: 5,
  });
  const sellers = await prisma.sellerProfile.findMany({ where: { id: { in: rows.map((row) => row.sellerId) } }, select: { id: true, storeName: true } });
  const names = new Map(sellers.map((seller) => [seller.id, seller.storeName]));
  return rows.map((row) => ({ seller: names.get(row.sellerId) ?? "Seller", grossAmount: row._sum.grossAmount ?? 0, platformFee: row._sum.platformFee ?? 0, netAmount: row._sum.netAmount ?? 0, orders: row._count.orderId }));
}

export async function recentSellerFinance(sellerId: string, limit = 5) {
  const transactions = await prisma.sellerWalletTransaction.findMany({ where: { sellerId }, select: { id: true, type: true, amount: true, description: true, createdAt: true, referenceType: true, referenceId: true }, orderBy: { createdAt: "desc" }, take: limit });
  const earningIds = transactions.filter((transaction) => transaction.referenceType === "SellerEarning").map((transaction) => transaction.referenceId);
  const earnings = await prisma.sellerEarning.findMany({ where: { id: { in: earningIds } }, select: { id: true, status: true, order: { select: { orderNumber: true } } } });
  const earningById = new Map(earnings.map((earning) => [earning.id, earning]));
  return transactions.map((transaction) => ({ ...transaction, earning: earningById.get(transaction.referenceId) ?? null }));
}

// Fees use integer minor units and round half up to keep every checkout deterministic.
export function calculatePlatformFee(grossAmount: number, commissionPercent: number) {
  return Math.floor((grossAmount * commissionPercent + 50) / 100);
}

export async function createSellerEarningsForPaidOrder(tx: Tx, orderId: string) {
  const [order, settings] = await Promise.all([
    tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, studioCreditTopUp: { select: { id: true } } },
    }),
    tx.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} }),
  ]);
  if (!order) throw new Error("Order not found");
  // Studio Credit is a first-party balance purchase, never a marketplace sale.
  if (order.studioCreditTopUp) return;
  for (const item of order.items) {
    if (!item.product.sellerId) continue;
    const grossAmount = item.unitPrice * item.quantity;
    const platformFee = calculatePlatformFee(grossAmount, settings.platformCommissionPercent);
    const netAmount = grossAmount - platformFee;
    const earning = await tx.sellerEarning.upsert({
      where: { orderItemId: item.id },
      create: { sellerId: item.product.sellerId, orderId, orderItemId: item.id, grossAmount, platformFee, netAmount, commissionPercent: settings.platformCommissionPercent },
      update: {},
    });
    await tx.sellerWalletTransaction.upsert({
      where: { type_referenceType_referenceId: { type: "SALE_PENDING", referenceType: "SellerEarning", referenceId: earning.id } },
      create: { sellerId: earning.sellerId, type: "SALE_PENDING", amount: earning.netAmount, referenceType: "SellerEarning", referenceId: earning.id, description: `Pending sale ${order.orderNumber}` },
      update: {},
    });
  }
}

export async function createSellerEarningForOrderItem(
  tx: Tx,
  input: { orderId: string; orderNumber: string; orderItemId: string; sellerId: string; unitPrice: number; quantity: number },
) {
  const settings = await tx.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} });
  const grossAmount = input.unitPrice * input.quantity;
  const platformFee = calculatePlatformFee(grossAmount, settings.platformCommissionPercent);
  const netAmount = grossAmount - platformFee;
  const earning = await tx.sellerEarning.upsert({
    where: { orderItemId: input.orderItemId },
    create: { sellerId: input.sellerId, orderId: input.orderId, orderItemId: input.orderItemId, grossAmount, platformFee, netAmount, commissionPercent: settings.platformCommissionPercent },
    update: {},
  });
  await tx.sellerWalletTransaction.upsert({
    where: { type_referenceType_referenceId: { type: "SALE_PENDING", referenceType: "SellerEarning", referenceId: earning.id } },
    create: { sellerId: earning.sellerId, type: "SALE_PENDING", amount: earning.netAmount, referenceType: "SellerEarning", referenceId: earning.id, description: `Pending sale ${input.orderNumber}` },
    update: {},
  });
  return { earning, settlementDays: settings.sellerSettlementDays };
}

async function itemIsDelivered(tx: Tx, orderItemId: string) {
  const deliveries = await tx.digitalDelivery.findMany({ where: { orderItemId }, select: { status: true } });
  return deliveries.length > 0 && deliveries.every((delivery) => delivery.status === "DELIVERED");
}

export async function markEarningsEligibleForOrder(tx: Tx, orderId: string) {
  const earnings = await tx.sellerEarning.findMany({ where: { orderId, status: "PENDING" } });
  if (!earnings.length) return;
  const settings = await tx.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} });
  const now = new Date();
  for (const earning of earnings) {
    if (!(await itemIsDelivered(tx, earning.orderItemId))) continue;
    const availableAt = new Date(now.getTime() + settings.sellerSettlementDays * 86400000);
    await tx.sellerEarning.update({ where: { id: earning.id, status: "PENDING" }, data: { availableAt } });
    if (settings.sellerSettlementDays === 0) await promoteEarning(tx, earning.id);
  }
}

export type EarningReleaseResult = "RELEASED" | "ALREADY_AVAILABLE" | "WAITING_HOLD" | "SKIPPED";

export async function releaseEarning(tx: Tx, earningId: string, notificationCopy?: { title: string; message: string; link: string } | null): Promise<EarningReleaseResult> {
  const earning = await tx.sellerEarning.findUnique({ where: { id: earningId } });
  if (!earning || earning.status === SellerEarningStatus.REVERSED || earning.status === SellerEarningStatus.PAID_OUT) return "SKIPPED";
  if (earning.status === SellerEarningStatus.PENDING && (!earning.availableAt || earning.availableAt > new Date())) return "WAITING_HOLD";
  const wasAvailable = earning.status === SellerEarningStatus.AVAILABLE;
  if (earning.status === SellerEarningStatus.PENDING) {
    await tx.sellerEarning.update({ where: { id: earning.id, status: "PENDING" }, data: { status: "AVAILABLE" } });
  }
  const existingLedger = await tx.sellerWalletTransaction.findUnique({ where: { type_referenceType_referenceId: { type: "SALE_AVAILABLE", referenceType: "SellerEarning", referenceId: earning.id } } });
  await tx.sellerWalletTransaction.upsert({
    where: { type_referenceType_referenceId: { type: "SALE_AVAILABLE", referenceType: "SellerEarning", referenceId: earning.id } },
    create: { sellerId: earning.sellerId, type: "SALE_AVAILABLE", amount: earning.netAmount, referenceType: "SellerEarning", referenceId: earning.id, description: "Seller earning available" },
    update: {},
  });
  if (!existingLedger) {
    const seller = await tx.sellerProfile.findUnique({ where: { id: earning.sellerId } });
    if (seller && notificationCopy !== null) await tx.notification.create({ data: { userId: seller.userId, title: notificationCopy?.title ?? "Saldo Penjualan Tersedia", message: notificationCopy?.message ?? "Pendapatan penjualan kamu sudah tersedia.", type: "EARNING", link: notificationCopy?.link ?? "/seller/wallet" } });
  }
  return wasAvailable ? "ALREADY_AVAILABLE" : "RELEASED";
}

export async function makeManualEarningAvailable(tx: Tx, orderItemId: string, notificationCopy: { title: string; message: string; link: string } | null) {
  const earning = await tx.sellerEarning.findUnique({ where: { orderItemId } });
  if (!earning || earning.status === "REVERSED" || earning.status === "PAID_OUT") return "SKIPPED" as const;
  await tx.sellerEarning.updateMany({ where: { id: earning.id, status: "PENDING" }, data: { availableAt: new Date() } });
  return releaseEarning(tx, earning.id, notificationCopy);
}

async function promoteEarning(tx: Tx, earningId: string) {
  const earning = await tx.sellerEarning.findUnique({ where: { id: earningId } });
  if (!earning || earning.status !== SellerEarningStatus.PENDING || !earning.availableAt || earning.availableAt > new Date()) return false;
  return releaseEarning(tx, earningId);
}

export async function releaseDueSellerEarnings(tx: Tx, sellerId?: string) {
  const earnings = await tx.sellerEarning.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() }, ...(sellerId ? { sellerId } : {}), order: { payment: { is: { status: "PAID" } } } },
    select: { id: true, orderItemId: true },
  });
  let released = 0;
  for (const earning of earnings) {
    if (!(await itemIsDelivered(tx, earning.orderItemId))) continue;
    const result = await promoteEarning(tx, earning.id);
    if (result === "RELEASED") released += 1;
  }
  return released;
}

export async function promoteDueEarnings(tx: Tx, sellerId?: string) {
  return releaseDueSellerEarnings(tx, sellerId);
}

export async function availableBalance(tx: Tx, sellerId: string) {
  await releaseDueSellerEarnings(tx, sellerId);
  const [ledger, earnings] = await Promise.all([
    tx.sellerWalletTransaction.findMany({ where: { sellerId, type: { in: ["SALE_AVAILABLE", "WITHDRAW_RELEASED", "WITHDRAW_RESERVED", "WITHDRAW_PAID", "PROMOTION_RESERVED", "PROMOTION_RELEASED", "PROMOTION_CHARGED"] } }, select: { type: true, amount: true, referenceType: true, referenceId: true } }),
    tx.sellerEarning.findMany({ where: { sellerId, status: { in: ["AVAILABLE", "PAID_OUT"] } }, select: { id: true, status: true } }),
  ]);
  return sumSellerAvailableBalance(ledger, earnings);
}

export async function balanceSummary(sellerId: string) {
  const { acceptDueManualDeliveries } = await import("@/lib/delivery/service");
  await acceptDueManualDeliveries();
  return prisma.$transaction(async (tx) => {
    const available = await availableBalance(tx, sellerId);
    const [pending, withdrawing, lifetime, nextPending] = await Promise.all([
      tx.sellerEarning.aggregate({ where: { sellerId, status: "PENDING" }, _sum: { netAmount: true } }),
      tx.withdrawal.aggregate({ where: { sellerId, status: { in: ["PENDING", "APPROVED"] } }, _sum: { amount: true } }),
      tx.sellerEarning.aggregate({ where: { sellerId, status: { not: "REVERSED" } }, _sum: { netAmount: true } }),
      tx.sellerEarning.findFirst({ where: { sellerId, status: "PENDING", availableAt: { not: null } }, select: { availableAt: true }, orderBy: { availableAt: "asc" } }),
    ]);
    return { available, pending: pending._sum.netAmount ?? 0, withdrawing: withdrawing._sum.amount ?? 0, lifetime: lifetime._sum.netAmount ?? 0, totalEarnings: lifetime._sum.netAmount ?? 0, nextPendingAvailableAt: nextPending?.availableAt ?? null };
  });
}

export async function reverseEarning(tx: Tx, earningId: string, reason: string) {
  const earning = await tx.sellerEarning.findUnique({ where: { id: earningId } });
  if (!earning || earning.status === "REVERSED") return;
  const wasAvailable = earning.status === "AVAILABLE" || earning.status === "PAID_OUT";
  await tx.sellerEarning.update({ where: { id: earning.id }, data: { status: "REVERSED" } });
  if (!wasAvailable) return;
  await tx.sellerWalletTransaction.upsert({
    where: { type_referenceType_referenceId: { type: "REFUND_REVERSAL", referenceType: "SellerEarning", referenceId: earning.id } },
    create: { sellerId: earning.sellerId, type: "REFUND_REVERSAL", amount: -earning.netAmount, referenceType: "SellerEarning", referenceId: earning.id, description: reason },
    update: {},
  });
}

export async function reverseOrderEarnings(tx: Tx, orderId: string, reason: string) {
  const earnings = await tx.sellerEarning.findMany({ where: { orderId }, select: { id: true } });
  for (const earning of earnings) await reverseEarning(tx, earning.id, reason);
  return earnings.length;
}
