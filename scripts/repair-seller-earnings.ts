import { PrismaClient } from "@prisma/client";
import { createSellerEarningForOrderItem, markEarningsEligibleForOrder, releaseEarning } from "../src/lib/seller-finance";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type Candidate = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderItemId: string;
  productId: string;
  productName: string;
  sellerId: string | null;
  unitPrice: number;
  quantity: number;
  grossAmount: number;
  paymentStatus: string;
  deliveryStatus: string;
  sellerSnapshot: string | null;
  earning: { id: string; sellerId: string; status: string; grossAmount: number; platformFee: number; netAmount: number } | null;
  ledgerStatus: string;
  ownershipSource: string;
  reason: string;
  action: "CREATE" | "RELEASE" | "WAIT" | "SKIP" | "UNRESOLVED";
  fee: number;
  net: number;
};

async function resolveOwnership(product: { sellerId: string | null; id: string; createdAt: Date }) {
  if (product.sellerId) return { sellerId: product.sellerId, source: "Product.sellerId", kind: "SELLER" as const };
  const logs = await prisma.auditLog.findMany({ where: { entityType: "Product", entityId: product.id, action: "SELLER_PRODUCT_CREATED" }, select: { actorId: true } });
  const actorIds = [...new Set(logs.map((log) => log.actorId).filter((id): id is string => Boolean(id)))];
  if (!actorIds.length) {
    const firstSeller = await prisma.sellerProfile.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (firstSeller && product.createdAt < firstSeller.createdAt) return { sellerId: null, source: "No seller audit; product predates first SellerProfile", kind: "PLATFORM" as const };
    return { sellerId: null, source: "No SELLER_PRODUCT_CREATED audit", kind: "UNRESOLVED" as const };
  }
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds }, role: "SELLER" }, select: { id: true, sellerProfile: { select: { id: true } } } });
  const sellerIds = [...new Set(actors.map((actor) => actor.sellerProfile?.id).filter((id): id is string => Boolean(id)))];
  return sellerIds.length === 1 && actors.length === actorIds.length ? { sellerId: sellerIds[0], source: "SELLER_PRODUCT_CREATED audit", kind: "SELLER" as const } : { sellerId: null, source: "SELLER_PRODUCT_CREATED audit tidak tunggal/valid", kind: "UNRESOLVED" as const };
}

async function inspectCandidate(item: {
  id: string; orderId: string; productId: string; productName: string; unitPrice: number; quantity: number;
  order: { orderNumber: string; status: string; payment: { status: string } | null };
  product: { id: string; sellerId: string | null; createdAt: Date }; deliveries: { status: string }[];
  earning: { id: string; sellerId: string; status: string; grossAmount: number; platformFee: number; netAmount: number; availableAt: Date | null } | null;
}, commissionPercent: number): Promise<Candidate | null> {
  if (item.order.payment?.status !== "PAID" || item.deliveries.length !== item.quantity || item.deliveries.some((delivery) => delivery.status !== "DELIVERED")) return null;
  const ownership = await resolveOwnership(item.product);
  const grossAmount = item.unitPrice * item.quantity;
  const fee = Math.floor((grossAmount * commissionPercent + 50) / 100);
  const net = grossAmount - fee;
  let ledgerStatus = "NONE";
  if (item.earning) {
    const ledger = await prisma.sellerWalletTransaction.findFirst({ where: { referenceType: "SellerEarning", referenceId: item.earning.id, type: { in: ["SALE_PENDING", "SALE_AVAILABLE"] } }, select: { type: true } });
    ledgerStatus = ledger?.type === "SALE_AVAILABLE" ? "AVAILABLE" : ledger?.type === "SALE_PENDING" ? "PENDING" : "NONE";
  }
  const now = new Date();
  const action = ownership.kind === "PLATFORM" ? "SKIP" : ownership.kind === "UNRESOLVED" ? "UNRESOLVED" : !item.earning ? "CREATE" : item.earning.status === "PENDING" && ledgerStatus !== "AVAILABLE" ? (item.earning.availableAt && item.earning.availableAt > now ? "WAIT" : "RELEASE") : "SKIP";
  const reason = action === "SKIP" && ownership.kind === "PLATFORM" ? "Platform product: tidak ada seller ownership dan produk dibuat sebelum SellerProfile pertama" : action === "UNRESOLVED" ? "Seller ownership tidak dapat dibuktikan secara deterministik" : "";
  return { orderId: item.orderId, orderNumber: item.order.orderNumber, orderStatus: item.order.status, orderItemId: item.id, productId: item.productId, productName: item.productName, sellerId: ownership.sellerId, paymentStatus: item.order.payment?.status ?? "NONE", deliveryStatus: item.deliveries.map((delivery) => delivery.status).join(","), sellerSnapshot: null, unitPrice: item.unitPrice, quantity: item.quantity, grossAmount, earning: item.earning, ledgerStatus, ownershipSource: ownership.source, reason, action, fee: item.earning?.platformFee ?? fee, net: item.earning?.netAmount ?? net };
}

async function main() {
  const settings = await prisma.storeSetting.findUnique({ where: { id: "default" } });
  const commissionPercent = settings?.platformCommissionPercent ?? 10;
  const orders = await prisma.order.findMany({ where: { payment: { is: { status: "PAID" } } }, include: { payment: true, items: { include: { product: true, deliveries: true, earning: true } } }, orderBy: { createdAt: "asc" } });
  const candidates: Candidate[] = [];
  for (const order of orders) for (const item of order.items) {
    const candidate = await inspectCandidate({ ...item, order: { orderNumber: order.orderNumber, status: order.status, payment: order.payment } }, commissionPercent);
    if (candidate) candidates.push(candidate);
  }

  for (const candidate of candidates) {
    console.log(JSON.stringify({ orderNumber: candidate.orderNumber, orderStatus: candidate.orderStatus, orderItemId: candidate.orderItemId, productId: candidate.productId, productName: candidate.productName, paymentStatus: candidate.paymentStatus, deliveryStatus: candidate.deliveryStatus, sellerId: candidate.sellerId, sellerSnapshot: candidate.sellerSnapshot, existingEarning: candidate.earning ? { id: candidate.earning.id, sellerId: candidate.earning.sellerId, status: candidate.earning.status, availableAt: candidate.earning.availableAt } : null, existingLedgerStatus: candidate.ledgerStatus, ownershipEvidence: candidate.ownershipSource, action: candidate.action, reason: candidate.reason, gross: candidate.grossAmount, fee: candidate.fee, net: candidate.net }));
    if (!apply || candidate.action === "WAIT" || candidate.action === "SKIP" || candidate.action === "UNRESOLVED") continue;
    await prisma.$transaction(async (tx) => {
      const current = await tx.orderItem.findUnique({ where: { id: candidate.orderItemId }, include: { earning: true } });
      if (!current) throw new Error(`OrderItem tidak ditemukan: ${candidate.orderItemId}`);
      let earning = current.earning;
      if (!earning) {
        if (!candidate.sellerId) throw new Error(`Seller tidak ditemukan untuk OrderItem: ${candidate.orderItemId}`);
        ({ earning } = await createSellerEarningForOrderItem(tx, { orderId: candidate.orderId, orderNumber: candidate.orderNumber, orderItemId: candidate.orderItemId, sellerId: candidate.sellerId, unitPrice: current.unitPrice, quantity: current.quantity }));
      }
      if (candidate.action === "CREATE") {
        await markEarningsEligibleForOrder(tx, candidate.orderId);
      } else if (candidate.action === "RELEASE") {
        const result = await releaseEarning(tx, earning.id);
        if (result !== "RELEASED" && result !== "ALREADY_AVAILABLE") throw new Error(`Earning belum eligible untuk dirilis: ${earning.id} (${result})`);
      }
    }, { isolationLevel: "Serializable" });
  }

  const totals = candidates.reduce((result, candidate) => { result.total += 1; result[candidate.action] += 1; if (candidate.sellerId) { result.gross += candidate.grossAmount; result.fee += candidate.fee; result.net += candidate.net; } return result; }, { total: 0, CREATE: 0, RELEASE: 0, WAIT: 0, SKIP: 0, UNRESOLVED: 0, gross: 0, fee: 0, net: 0 });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...totals }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Repair gagal."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
