import { prisma } from "@/lib/prisma";

async function main() {
  const refunds = await prisma.refundRequest.findMany({ where: { status: "REFUNDED" }, select: { id: true, amount: true, orderId: true, order: { select: { orderNumber: true, earnings: { select: { id: true, sellerId: true, netAmount: true, status: true } } } } } });
  for (const refund of refunds) {
    const ledgers = await prisma.sellerWalletTransaction.findMany({ where: { type: "REFUND_REVERSAL", referenceType: "SellerEarning", referenceId: { in: refund.order.earnings.map((earning) => earning.id) } }, select: { referenceId: true } });
    const reversedIds = new Set(ledgers.map((ledger) => ledger.referenceId));
    const missing = refund.order.earnings.filter((earning) => earning.status !== "REVERSED" || !reversedIds.has(earning.id));
    if (missing.length) console.log(JSON.stringify({ refundId: refund.id, orderId: refund.orderId, orderNumber: refund.order.orderNumber, amount: refund.amount, earningsNeedingReconciliation: missing }));
  }
}

main().finally(() => prisma.$disconnect());
