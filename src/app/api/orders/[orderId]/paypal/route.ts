import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { captureBuyerPayPalOrder, createPayPalCheckout } from "@/lib/payments/paypal-service";

export const runtime = "nodejs";
const input = z.object({ action: z.enum(["create", "capture"]), paypalOrderId: z.string().min(1).max(128).optional() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.action === "capture" && !parsed.data.paypalOrderId)) return NextResponse.json({ error: "Permintaan PayPal tidak valid." }, { status: 400 });
  try {
    const orderId = (await params).orderId;
    const result = parsed.data.action === "create"
      ? await createPayPalCheckout(orderId, session.user.id)
      : await captureBuyerPayPalOrder(orderId, session.user.id, parsed.data.paypalOrderId!);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayPal belum dapat diproses." }, { status: 409 });
  }
}
