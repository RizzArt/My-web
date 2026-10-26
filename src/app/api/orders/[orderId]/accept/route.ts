import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { completeManualDelivery } from "@/lib/delivery/service";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { deliveryId?: unknown } | null;
  if (typeof body?.deliveryId !== "string" || !body.deliveryId) return NextResponse.json({ error: "Delivery tidak valid." }, { status: 400 });
  const { orderId } = await params;
  try {
    await completeManualDelivery({ deliveryId: body.deliveryId, orderId, source: "BUYER", customerId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pesanan tidak dapat diterima.";
    const status = message.includes("bukan milik") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
