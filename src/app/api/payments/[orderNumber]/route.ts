import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { verifySociaBuzzOrder } from "@/lib/payments/sociabuzz-service";
import { hasActiveSociaBuzzInvoice } from "@/lib/payments/sociabuzz-guard";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderNumber } = await params;
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId: session.user.id },
    include: { payment: true },
  });
  if (!order?.payment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    orderNumber,
    orderStatus: order.status,
    paymentStatus: order.payment.status,
  });
}

export async function POST(
  _: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderNumber } = await params;
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId: session.user.id },
    include: { payment: true },
  });
  if (!order?.payment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    if (hasActiveSociaBuzzInvoice(order.payment)) {
      const result = await verifySociaBuzzOrder(order.id, session.user.id);
      return NextResponse.json({
        orderNumber,
        paymentStatus: result.status,
      });
    }

    if (
      order.payment.provider === "MIDTRANS" &&
      order.payment.status === "PENDING" &&
      order.payment.externalId
    ) {
      const status = await new MidtransProvider().getPaymentStatus(
        order.payment.externalId,
      );
      return NextResponse.json({
        orderNumber,
        paymentStatus: status,
        note: "Status is finalized by provider webhook",
      });
    }

    return NextResponse.json({
      orderNumber,
      paymentStatus: order.payment.status,
    });
  } catch {
    return NextResponse.json({
      error: "Status pembayaran belum dapat diperiksa.",
    }, { status: 503 });
  }
}
