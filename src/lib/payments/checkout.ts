import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { customerPaymentsAvailable, getPaymentProvider, paymentProviderName } from "./provider";
import { getAvailableInventoryMap, inventoryProductTypes } from "@/lib/product-stock";

import { selectVaBank } from "./ipaymu-options";
import { ipaymuConfig } from "./ipaymu-client";
import { paypalIsAvailable } from "./paypal";
import { assertPayPalEligibleOrderItems } from "./paypal-eligibility";

const customerInput = z.object({
  paymentMethod: z.enum(["default", "ipaymu_va", "paypal"]).optional(),
  paymentBank: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(1, "Nama lengkap wajib diisi").max(120),
  customerEmail: z.string().trim().email("Email penerima tidak valid").max(320),
  customerEmailConfirmation: z.string().trim().email("Konfirmasi email tidak valid"),
  customerPhone: z.string().trim().max(40).optional().or(z.literal("")),
  customerNote: z.string().trim().max(1000).optional().or(z.literal("")),
});
const cartInput = z.object({ items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(50) });
export const checkoutInput = cartInput.merge(customerInput).refine((value) => value.customerEmail.toLowerCase() === value.customerEmailConfirmation.toLowerCase(), {
  path: ["customerEmailConfirmation"], message: "Konfirmasi email harus sama",
});
export function calculateCheckout(products: Array<{ id: string; name: string; price: number }>, input: unknown) {
  const parsed = cartInput.parse(input);
  const requested = new Map(parsed.items.map((item) => [item.productId, item.quantity]));
  if (products.length !== requested.size) throw new Error("One or more products are unavailable");
  const lineItems = products.map((product) => ({ productId: product.id, name: product.name, price: product.price, quantity: requested.get(product.id) ?? 0 }));
  return { lineItems, subtotal: lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0) };
}
export async function createCheckout(user: { id: string; name?: string | null; email?: string | null }, input: unknown) {
  const parsed = checkoutInput.parse(input);
  const vaBank = parsed.paymentMethod === "ipaymu_va"
    ? await selectVaBank(parsed.paymentBank) : null;
  const paypal = parsed.paymentMethod === "paypal";
  if (vaBank && !/^\+?[0-9]{8,15}$/.test((parsed.customerPhone ?? "").replace(/[\s()-]/g, ""))) {
    throw new Error("Nomor HP yang valid wajib untuk pembayaran VA.");
  }
  if (paypal && !paypalIsAvailable()) throw new Error("PayPal belum diaktifkan.");
  if (!vaBank && !paypal && !customerPaymentsAvailable()) throw new Error(paymentProviderName() === "qris_manual" ? "Metode pembayaran QRIS belum tersedia." : "Pembayaran online sedang dalam proses aktivasi.");
  const products = await prisma.product.findMany({ where: { id: { in: parsed.items.map((item) => item.productId) }, isPublished: true, moderationStatus: "APPROVED", ...activeSellerProductWhere() } });
  const inventoryMap = await getAvailableInventoryMap(products.filter((product) => product.deliveryMode === "AUTO" && inventoryProductTypes.includes(product.type)).map((product) => product.id));
  for (const item of parsed.items) {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) continue;
    const available = product.deliveryMode === "AUTO" && inventoryProductTypes.includes(product.type) ? (inventoryMap.get(product.id) ?? 0) : product.stock;
    if (available !== null && available < item.quantity) throw new Error(`${product.name} kehabisan stok atau stok tidak mencukupi`);
  }
  const { lineItems, subtotal } = calculateCheckout(products, parsed);
  const orderNumber = `KS-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const order = await prisma.$transaction(async (tx) => {
    const buyer = await tx.user.findUnique({
      where: { id: user.id },
      select: { isActive: true },
    });
    if (!buyer?.isActive) throw new Error("Akun tidak aktif.");
    const eligible = await tx.product.findMany({
      where: {
        id: { in: lineItems.map((item) => item.productId) },
        isPublished: true,
        moderationStatus: "APPROVED",
        ...activeSellerProductWhere(),
      },
      select: { id: true, sellerId: true },
    });
    if (eligible.length !== lineItems.length) {
      throw new Error("Produk atau seller sudah tidak tersedia.");
    }
    if (paypal) await assertPayPalEligibleOrderItems(eligible.map((product) => ({ product })), tx);
    const created = await tx.order.create({ data: { orderNumber, userId: user.id, customerName: parsed.customerName, customerEmail: parsed.customerEmail.toLowerCase(), customerPhone: parsed.customerPhone || null, customerNote: parsed.customerNote || null, subtotal, total: subtotal, status: "PENDING", items: { create: lineItems.map((item) => ({ productId: item.productId, productName: item.name, unitPrice: item.price, quantity: item.quantity })) }, payment: { create: { amount: subtotal, provider: vaBank ? "IPAYMU" : paypal ? "PAYPAL" : paymentProviderName().toUpperCase(), status: "PENDING" } } }, include: { payment: true, items: true } });
    if (vaBank && created.payment) {
      await tx.payment.update({
        where: { id: created.payment.id },
        data: { externalId: `ipaymu_draft:${vaBank.code}:${created.id}` },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: created.payment.id,
          provider: "IPAYMU",
          providerEventId: `draft:${created.id}`,
          eventType: "IPAYMU_VA_DRAFT",
          payload: {
            bank: vaBank.code,
            bankName: vaBank.name,
            fee: vaBank.fee,
            feeDirection: "BUYER",
            mode: ipaymuConfig().mode,
          },
        },
      });
    }
    for (const item of created.items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product || product.deliveryMode !== "AUTO" || !inventoryProductTypes.includes(product.type)) continue;
      const available = await tx.digitalInventory.findMany({ where: { productId: item.productId, status: "AVAILABLE", isSold: false }, orderBy: { createdAt: "asc" }, take: item.quantity, select: { id: true } });
      if (available.length !== item.quantity) throw new Error(`${item.productName} kehabisan stok atau stok tidak mencukupi`);
      for (const inventory of available) {
        const claimed = await tx.digitalInventory.updateMany({ where: { id: inventory.id, status: "AVAILABLE", isSold: false }, data: { status: "ASSIGNED", assignedOrderId: created.id, assignedOrderItemId: item.id, assignedAt: new Date() } });
        if (claimed.count !== 1) throw new Error(`${item.productName} kehabisan stok atau stok tidak mencukupi`);
      }
    }
    return created;
  }, { isolationLevel: "Serializable" });
  if (vaBank || paypal) return {
    orderNumber,
    redirectUrl: `/payment/${orderNumber}`,
  };
  try {
    const payment = await getPaymentProvider().createPayment({ orderId: order.id, orderNumber, amount: subtotal, customer: { name: parsed.customerName, email: parsed.customerEmail }, items: lineItems.map((item) => ({ id: item.productId, name: item.name, price: item.price, quantity: item.quantity })) });
    if (!order.payment) throw new Error("Payment record was not created");
    await prisma.payment.update({ where: { id: order.payment.id }, data: { externalId: payment.providerTransactionId } });
    return { orderNumber, redirectUrl: payment.redirectUrl };
  } catch (error) {
    if (order.payment) await prisma.payment.update({ where: { id: order.payment.id }, data: { status: "FAILED" } });
    await prisma.digitalInventory.updateMany({ where: { assignedOrderId: order.id, status: "ASSIGNED", isSold: false }, data: { status: "AVAILABLE", assignedOrderId: null, assignedOrderItemId: null, assignedAt: null } });
    throw error;
  }
}
