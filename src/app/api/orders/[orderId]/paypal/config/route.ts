import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { paypalPublicConfig } from "@/lib/payments/paypal";
import { assertPayPalEligibleOrderItems } from "@/lib/payments/paypal-eligibility";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const order = await prisma.order.findFirst({
    where: { id: (await params).orderId, userId: session.user.id },
    include: { payment: { select: { provider: true } }, items: { include: { product: { select: { sellerId: true } } } } },
  });
  if (!order || order.payment?.provider !== "PAYPAL") {
    return NextResponse.json({ paypal: { enabled: false } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await assertPayPalEligibleOrderItems(order.items);
    return NextResponse.json({ paypal: paypalPublicConfig() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ paypal: { enabled: false } }, { headers: { "Cache-Control": "no-store" } });
  }
}
