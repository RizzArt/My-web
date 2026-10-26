import { claimDeliveryInventory } from "./claim-inventory";
import { createHash } from "node:crypto";
import { notifyAdmins } from "@/lib/admin-notifications";
import { Prisma, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendDigitalDeliveryEmail, type DeliveryEmail } from "@/lib/email/service";
import { decryptSecret, encryptSecret, hashDownloadToken, newDownloadToken } from "@/lib/security/secrets";
import { createSellerEarningsForPaidOrder, makeManualEarningAvailable, markEarningsEligibleForOrder } from "@/lib/seller-finance";
import { publishNotification } from "@/lib/realtime/publish";

const linkExpiryDays = Number(process.env.DOWNLOAD_LINK_EXPIRY_DAYS ?? 7);
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
export const MANUAL_ACCEPTANCE_HOURS = 24;

export function getManualAutoAcceptAt(sentAt: Date) {
  return new Date(sentAt.getTime() + MANUAL_ACCEPTANCE_HOURS * 60 * 60 * 1000);
}

type Tx = Prisma.TransactionClient;

async function markOrderCompletedIfReady(tx: Tx, orderId: string) {
  const [deliveryCount, pendingCount] = await Promise.all([
    tx.digitalDelivery.count({ where: { orderId } }),
    tx.digitalDelivery.count({ where: { orderId, status: { not: "DELIVERED" } } }),
  ]);
  if (deliveryCount === 0 || pendingCount !== 0) return false;
  const result = await tx.order.updateMany({
    where: { id: orderId, status: "PAID" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return result.count === 1;
}

async function createOneDelivery(tx: Tx, order: { id: string; userId: string }, item: { id: string; productId: string; productName: string; quantity: number; product: { type: ProductType; deliveryMode: "AUTO" | "MANUAL" } }, quantityIndex: number) {
  const existing = await tx.digitalDelivery.findUnique({ where: { orderItemId_quantityIndex: { orderItemId: item.id, quantityIndex } }, include: { inventory: true } });
  if (existing) return existing;
  if (item.product.deliveryMode === "MANUAL") return tx.digitalDelivery.create({ data: { orderId: order.id, orderItemId: item.id, type: item.product.type, status: "WAITING_MANUAL_DELIVERY", quantityIndex }, include: { inventory: true } });
  if (item.product.type === "FILE") return tx.digitalDelivery.create({ data: { orderId: order.id, orderItemId: item.id, type: item.product.type, status: "DELIVERED", deliveredAt: new Date(), quantityIndex }, include: { inventory: true } });
  const inventory = await claimDeliveryInventory(
    tx, order.id, item.id, item.productId, item.productName
  );
  return tx.digitalDelivery.create({ data: { orderId: order.id, orderItemId: item.id, inventoryId: inventory.id, type: item.product.type, valueEncrypted: encryptSecret(decryptSecret(inventory.secretValue)), status: "DELIVERED", deliveredAt: new Date(), quantityIndex }, include: { inventory: true } });
}

async function loadDeliveries(orderId: string) {
  return prisma.digitalDelivery.findMany({ where: { orderId, status: { in: ["DELIVERED", "AWAITING_CONFIRMATION"] } }, include: { orderItem: true, inventory: true }, orderBy: [{ orderItemId: "asc" }, { quantityIndex: "asc" }] });
}

async function emailData(orderId: string): Promise<DeliveryEmail[]> {
  const deliveries = await loadDeliveries(orderId);
  const result: DeliveryEmail[] = [];
  for (const delivery of deliveries) {
    const secret = decryptSecret(delivery.valueEncrypted ?? delivery.inventory?.secretValue ?? "");
    if (delivery.type === "FILE") {
      const token = newDownloadToken();
      const expiresAt = new Date(Date.now() + linkExpiryDays * 86400000);
      await prisma.digitalDelivery.update({ where: { id: delivery.id }, data: { downloadTokenHash: hashDownloadToken(token), downloadExpiresAt: expiresAt, expiresAt } });
      result.push({ productName: delivery.orderItem.productName, type: delivery.type, detail: "Secure download", link: `${appUrl}/download/${token}`, expiresAt });
    } else result.push({ productName: delivery.orderItem.productName, type: delivery.type, detail: secret });
  }
  return result;
}

export async function deliverOrder(orderId: string) {
  try {
    const result = await deliverOrderInternal(orderId);
    await notifyOrderAdminActivity(orderId);
    return result;
  } catch (error) {
    await notifyOrderAdminActivity(orderId, true);
    throw error;
  }
}

async function notifyOrderAdminActivity(orderId: string, failed = false) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, orderNumber: true, status: true, emailStatus: true,
        payment: { select: { status: true } }
      }
    });
    if (!order || order.payment?.status !== "PAID") return;
    const link = `/admin/orders/${order.id}`;
    await notifyAdmins({
      eventKey: `order-paid:${order.id}`,
      title: "Pembayaran Pesanan Berhasil",
      message: `Pembayaran pesanan ${order.orderNumber} telah terkonfirmasi.`,
      link
    });
    const manual = await prisma.digitalDelivery.count({
      where: { orderId, status: "WAITING_MANUAL_DELIVERY" }
    });
    if (manual && await notifyManualDeliverySellers(order.id) === 0) await notifyAdmins({
      eventKey: `manual-delivery-unassigned:${order.id}`,
      title: "Bantuan Pengiriman Manual Diperlukan",
      message: `Pesanan ${order.orderNumber} memiliki item manual tanpa seller penerima tugas.`,
      link
    });
    if (failed && ["PAID", "PROCESSING"].includes(order.status)) {
      await notifyAdmins({
        eventKey: `delivery-failed:${order.id}`,
        title: "Pengiriman Pesanan Bermasalah",
        message: `Periksa proses pengiriman pesanan ${order.orderNumber}.`,
        link
      });
    }
    if (order.emailStatus === "FAILED") await notifyAdmins({
      eventKey: `delivery-email-failed:${order.id}`,
      title: "Email Pengiriman Gagal",
      message: `Periksa email pengiriman pesanan ${order.orderNumber}.`,
      link
    });
  } catch {
    console.error("Order admin notification check failed");
  }
}

export function manualDeliverySellerNotificationId(orderId: string, sellerUserId: string) {
  return "c" + createHash("sha256")
    .update(JSON.stringify(["manual-delivery-task", orderId, sellerUserId]))
    .digest("hex").slice(0, 24);
}

// A seller receives one durable task per order, even if several units need manual delivery.
export async function notifyManualDeliverySellers(orderId: string) {
  try {
    const deliveries = await prisma.digitalDelivery.findMany({
      where: { orderId, status: "WAITING_MANUAL_DELIVERY" },
      select: {
        order: { select: { orderNumber: true } },
        orderItem: { select: { product: { select: { seller: { select: { userId: true } } } } } },
      },
    });
    const tasks = new Map<string, { orderNumber: string; deliveryCount: number }>();
    for (const delivery of deliveries) {
      const sellerUserId = delivery.orderItem.product.seller?.userId;
      if (!sellerUserId) continue;
      const current = tasks.get(sellerUserId);
      tasks.set(sellerUserId, {
        orderNumber: delivery.order.orderNumber,
        deliveryCount: (current?.deliveryCount ?? 0) + 1,
      });
    }
    if (!tasks.size) return 0;

    const rows = [...tasks.entries()].map(([userId, task]) => ({
      id: manualDeliverySellerNotificationId(orderId, userId),
      userId,
      title: "Tugas pengiriman manual baru",
      message: `Pesanan ${task.orderNumber} memiliki ${task.deliveryCount} item yang perlu Anda kirim.`,
      type: "DELIVERY_TASK",
      link: "/seller/orders",
    }));
    const notifications = await prisma.$transaction(async (tx) => {
      await tx.notification.createMany({ data: rows, skipDuplicates: true });
      return tx.notification.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    });
    await Promise.all(notifications.map(publishNotification));
    return tasks.size;
  } catch {
    console.error("Manual delivery seller notification failed");
    return 0;
  }
}

async function deliverOrderInternal(orderId: string) {
  const order = await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: true } }, user: true } });
    if (!current) throw new Error("Order not found");
    if (current.status !== "PAID") throw new Error("Only PAID orders can be delivered");
    for (const item of current.items) for (let index = 0; index < item.quantity; index += 1) await createOneDelivery(tx, current, item, index);
    await markOrderCompletedIfReady(tx, orderId);
    await createSellerEarningsForPaidOrder(tx, orderId);
    await markEarningsEligibleForOrder(tx, orderId);
    await tx.auditLog.create({ data: { action: "ORDER_DELIVERED", entityType: "Order", entityId: orderId, metadata: { orderNumber: current.orderNumber } } });
    return current;
  }, { isolationLevel: "Serializable" });
  const pendingManual = await prisma.digitalDelivery.count({ where: { orderId, status: "WAITING_MANUAL_DELIVERY" } });
  if (pendingManual && !await prisma.digitalDelivery.count({ where: { orderId, status: "DELIVERED" } })) return { order, deliveries: [], emailSent: false };
  if (order.emailStatus === "SENT") return { order, deliveries: [], emailSent: true };
  const deliveries = await emailData(orderId);
  try {
    if (!order.customerEmail) throw new Error("Order delivery email is missing");
    await sendDigitalDeliveryEmail({ to: order.customerEmail, customerName: order.customerName, orderNumber: order.orderNumber, deliveries });
    await prisma.order.update({ where: { id: orderId }, data: { emailStatus: "SENT", emailSentAt: new Date(), lastEmailError: null } });
    return { order, deliveries, emailSent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await prisma.order.update({ where: { id: orderId }, data: { emailStatus: "FAILED", emailRetryCount: { increment: 1 }, lastEmailError: message.slice(0, 500) } });
    console.error("Digital delivery email failed", { orderId, error: message });
    return { order, deliveries, emailSent: false };
  }
}

export async function manuallyDeliver(orderId: string, deliveryId: string, actorId: string, actorRole: "ADMIN" | "SELLER", input: { message: string; content?: string; accessLink?: string; credential?: string }) {
  const delivery = await prisma.digitalDelivery.findUnique({ where: { id: deliveryId }, include: { order: { include: { payment: true } }, orderItem: { include: { product: { include: { seller: true } } } } } });
  if (!delivery || delivery.status !== "WAITING_MANUAL_DELIVERY") throw new Error("Delivery manual tidak tersedia.");
  if (delivery.orderId !== orderId) throw new Error("Delivery tidak sesuai order.");
  if (delivery.order.status !== "PAID" || delivery.order.payment?.status !== "PAID") throw new Error("Order belum valid untuk dikirim.");
  if (actorRole === "SELLER" && delivery.orderItem.product.seller?.userId !== actorId) throw new Error("Seller tidak memiliki produk ini.");
  const parts = [input.message, input.content, input.accessLink ? `Access link: ${input.accessLink}` : "", input.credential ? `Credential: ${input.credential}` : ""].filter(Boolean);
  const transactionResult = await prisma.$transaction(async (tx) => {
    const sentAt = new Date();
    const result = await tx.digitalDelivery.update({ where: { id: deliveryId, status: "WAITING_MANUAL_DELIVERY" }, data: { status: "AWAITING_CONFIRMATION", valueEncrypted: encryptSecret(parts.join("\n\n")), manualMessage: input.message, deliveredAt: sentAt, sentAt, autoAcceptAt: getManualAutoAcceptAt(sentAt) } });
    const notification = await tx.notification.create({ data: { userId: delivery.order.userId, title: "Pesanan telah dikirim", message: "Periksa produk dan konfirmasi penerimaan.", type: "DELIVERY", link: `/dashboard/orders/${delivery.orderId}` } });
    await tx.auditLog.create({ data: { actorId, action: "MANUAL_DELIVERY_COMPLETED", entityType: "DigitalDelivery", entityId: deliveryId, metadata: { orderId: delivery.orderId, orderItemId: delivery.orderItemId } } });
    return { result, notification };
  });
  await publishNotification(transactionResult.notification);
  const deliveries = await emailData(delivery.orderId);
  try {
    if (!delivery.order.customerEmail) throw new Error("Order delivery email is missing");
    await sendDigitalDeliveryEmail({ to: delivery.order.customerEmail, customerName: delivery.order.customerName, orderNumber: delivery.order.orderNumber, deliveries });
    await prisma.order.update({ where: { id: delivery.orderId }, data: { emailStatus: "SENT", emailSentAt: new Date(), lastEmailError: null } });
  } catch (error) {
    await prisma.order.update({ where: { id: delivery.orderId }, data: { emailStatus: "FAILED", emailRetryCount: { increment: 1 }, lastEmailError: error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed" } });
  }
  return transactionResult.result;
}

export type ManualAcceptanceSource = "BUYER" | "AUTO";

function isRetryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function completeManualDeliveryTransaction(input: { deliveryId: string; orderId?: string; source: ManualAcceptanceSource; customerId?: string }) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.digitalDelivery.findUnique({ where: { id: input.deliveryId }, include: { order: { include: { payment: true } }, orderItem: { include: { product: { include: { seller: true } } } } } });
    if (!delivery || delivery.status !== "AWAITING_CONFIRMATION" || delivery.buyerAcceptedAt) throw new Error("Delivery belum menunggu konfirmasi.");
    if (delivery.orderItem.product.deliveryMode !== "MANUAL") throw new Error("Delivery bukan manual.");
    if (input.orderId && delivery.orderId !== input.orderId) throw new Error("Delivery tidak sesuai order.");
    if (input.source === "BUYER" && delivery.order.userId !== input.customerId) throw new Error("Order bukan milik customer.");
    if (delivery.order.status !== "PAID" || delivery.order.payment?.status !== "PAID") throw new Error("Order belum valid untuk diterima.");
    const now = new Date();
    if (input.source === "AUTO" && (!delivery.sentAt || !delivery.autoAcceptAt || delivery.autoAcceptAt > now)) throw new Error("Delivery belum jatuh tempo.");
    const claimed = await tx.digitalDelivery.updateMany({ where: { id: delivery.id, status: "AWAITING_CONFIRMATION", buyerAcceptedAt: null }, data: { status: "DELIVERED", buyerAcceptedAt: now } });
    if (claimed.count !== 1) throw new Error("Delivery belum menunggu konfirmasi.");
    const seller = delivery.orderItem.product.seller;
    const sellerCopy = input.source === "AUTO"
      ? { title: "Pesanan selesai otomatis", message: "Pesanan telah otomatis diterima setelah 24 jam.", link: "/seller/orders" }
      : { title: "Pesanan diterima", message: "Pesanan diterima dan saldo penjualan telah tersedia.", link: "/seller/wallet" };
    const itemDeliveries = await tx.digitalDelivery.findMany({ where: { orderItemId: delivery.orderItemId }, select: { status: true } });
    const itemComplete = itemDeliveries.length > 0 && itemDeliveries.every((itemDelivery) => itemDelivery.status === "DELIVERED");
    if (seller && itemComplete) await makeManualEarningAvailable(tx, delivery.orderItemId, null);
    const orderCompleted = await markOrderCompletedIfReady(tx, delivery.orderId);
    const notifications = [];
    if (seller && itemComplete) notifications.push(await tx.notification.create({ data: { userId: seller.userId, ...sellerCopy, type: "EARNING" } }));
    if (input.source === "AUTO") notifications.push(await tx.notification.create({ data: { userId: delivery.order.userId, title: "Pesanan selesai otomatis", message: "Pesanan telah otomatis diterima setelah 24 jam.", type: "DELIVERY", link: `/dashboard/orders/${delivery.orderId}` } }));
    await tx.auditLog.create({ data: { action: input.source === "AUTO" ? "MANUAL_DELIVERY_AUTO_ACCEPTED" : "MANUAL_DELIVERY_ACCEPTED", entityType: "DigitalDelivery", entityId: delivery.id, metadata: { orderId: delivery.orderId, orderItemId: delivery.orderItemId, source: input.source } } });
    return { updated: { ...delivery, status: "DELIVERED", buyerAcceptedAt: now }, notifications, orderCompleted };
  }, { isolationLevel: "Serializable" });
}

export async function completeManualDelivery(input: { deliveryId: string; orderId?: string; source: ManualAcceptanceSource; customerId?: string }) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await completeManualDeliveryTransaction(input);
      break;
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
    }
  }
  if (!result) throw new Error("Delivery tidak dapat diproses.");
  result.notifications.forEach(publishNotification);
  return result.updated;
}

export type ManualAutoAcceptSummary = { processed: number; accepted: number; skipped: number; failed: number };

export async function acceptDueManualDeliveries(now = new Date()): Promise<ManualAutoAcceptSummary> {
  const due = await prisma.digitalDelivery.findMany({ where: { status: "AWAITING_CONFIRMATION", buyerAcceptedAt: null, sentAt: { not: null }, autoAcceptAt: { lte: now }, order: { status: "PAID", payment: { is: { status: "PAID" } } }, orderItem: { product: { deliveryMode: "MANUAL" } } }, select: { id: true } });
  let accepted = 0;
  let skipped = 0;
  let failed = 0;
  for (const delivery of due) {
    try {
      await completeManualDelivery({ deliveryId: delivery.id, source: "AUTO" });
      accepted += 1;
    } catch (error) {
      if (error instanceof Error && ["Delivery belum menunggu konfirmasi.", "Delivery belum jatuh tempo.", "Delivery bukan manual.", "Order belum valid untuk diterima."].includes(error.message)) skipped += 1;
      else { failed += 1; console.error("Manual delivery auto-accept failed", { error: error instanceof Error ? error.name : "unknown" }); }
    }
  }
  return { processed: due.length, accepted, skipped, failed };
}

export async function retryOrderEmail(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "PAID") throw new Error("Only PAID orders can be emailed");
  if (!order.customerEmail) throw new Error("Order delivery email is missing");
  const deliveries = await emailData(orderId);
  await sendDigitalDeliveryEmail({ to: order.customerEmail, customerName: order.customerName, orderNumber: order.orderNumber, deliveries });
  await prisma.order.update({ where: { id: orderId }, data: { emailStatus: "SENT", emailSentAt: new Date(), lastEmailError: null } });
}
