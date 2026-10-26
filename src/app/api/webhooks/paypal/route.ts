import { NextResponse } from "next/server";
import { processPayPalWebhook } from "@/lib/payments/paypal-service";
import { verifyPayPalWebhook } from "@/lib/payments/paypal";
import { paypalWebhookOrderId } from "@/lib/payments/paypal-validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1024 * 1024) return NextResponse.json({ error: "Payload terlalu besar." }, { status: 413 });
  try {
    const event: unknown = JSON.parse(raw);
    if (!await verifyPayPalWebhook(request.headers, event)) return NextResponse.json({ error: "Signature PayPal tidak valid." }, { status: 401 });
    const details = paypalWebhookOrderId(event);
    if (details.eventType !== "PAYMENT.CAPTURE.COMPLETED") return NextResponse.json({ received: true, ignored: true });
    const result = await processPayPalWebhook(details.paypalOrderId, details.eventId);
    return NextResponse.json({ received: true, duplicate: result.duplicate, review: result.review });
  } catch {
    return NextResponse.json({ error: "Webhook PayPal belum dapat diproses." }, { status: 503 });
  }
}
