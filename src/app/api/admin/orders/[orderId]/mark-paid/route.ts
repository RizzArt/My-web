import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "@/lib/payments/paid-order-fulfillment";
import { createSellerEarningsForPaidOrder } from "@/lib/seller-finance";
import { qrisIsAvailable } from "@/lib/payments/qris";

const input = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  }
  const { orderId } = await params;

  const productionTestMode =
    process.env.NODE_ENV === "production" &&
    process.env.MANUAL_PAYMENT_TEST_MODE === "true" &&
    Boolean(process.env.MANUAL_PAYMENT_TEST_TOKEN) &&
    request.headers.get("x-manual-payment-test-token") ===
      process.env.MANUAL_PAYMENT_TEST_TOKEN;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { payment: true },
      });
      if (!order?.payment) throw new Error("Order not found");

      const manualAllowed =
        order.payment.provider === "QRIS_MANUAL"
          ? qrisIsAvailable()
          : order.payment.provider === "MANUAL" &&
            (process.env.NODE_ENV !== "production" || productionTestMode);

      if (!manualAllowed) {
        throw new Error("Pembayaran ini memerlukan verifikasi provider.");
      }
      if (
        order.payment.status === "PAID" &&
        ["PAID", "PROCESSING", "COMPLETED"].includes(order.status)
      ) {
        return;
      }
      if (order.payment.status !== "PENDING" || order.status !== "PENDING") {
        throw new Error("Pesanan tidak dapat ditandai PAID.");
      }

      const claimed = await tx.payment.updateMany({
        where: {
          id: order.payment.id,
          provider: order.payment.provider,
          status: "PENDING",
        },
        data: { status: "PAID", paidAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Pembayaran sudah berubah.");

      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });
      await createSellerEarningsForPaidOrder(tx, order.id);
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "ORDER_MARKED_PAID",
          entityType: "Order",
          entityId: order.id,
          metadata: { reason: parsed.data.reason },
        },
      });
    }, { isolationLevel: "Serializable" });

    const current = await prisma.order.findUnique({ where: { id: orderId } });
    if (current?.status === "PAID") await fulfillPaidOrder(orderId);
    return NextResponse.json({ ok: true });
  } catch {
    console.error("Admin mark-paid failed", { orderId });
    return NextResponse.json({
      error: "Pesanan tidak dapat ditandai PAID atau pengiriman perlu diperiksa.",
    }, { status: 400 });
  }
}
