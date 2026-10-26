export type PayPalCaptureEvidence = { captureId: string; amount: string; currency: string; merchantId: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Respons PayPal tidak valid.");
  return value as Record<string, unknown>;
}

export function validatePayPalCapture(order: unknown, expected: { paypalOrderId: string; orderId: string; orderNumber: string; amount: string; merchantId: string }) {
  const root = record(order);
  if (root.id !== expected.paypalOrderId || root.status !== "COMPLETED") throw new Error("Order PayPal belum COMPLETED.");
  const units = root.purchase_units;
  if (!Array.isArray(units) || units.length !== 1) throw new Error("Purchase unit PayPal tidak valid.");
  const unit = record(units[0]);
  const amount = record(unit.amount);
  if (unit.reference_id !== expected.orderNumber || unit.custom_id !== expected.orderId || amount.currency_code !== "USD" || amount.value !== expected.amount) {
    throw new Error("Referensi atau nominal PayPal tidak cocok.");
  }
  const captures = record(unit.payments).captures;
  if (!Array.isArray(captures) || captures.length !== 1) throw new Error("Capture PayPal tidak ditemukan.");
  const capture = record(captures[0]);
  const captureAmount = record(capture.amount);
  const unitPayee = unit.payee && record(unit.payee).merchant_id;
  const capturePayee = capture.payee && record(capture.payee).merchant_id;
  const merchantId = typeof capturePayee === "string" ? capturePayee : unitPayee;
  if (capture.status !== "COMPLETED" || captureAmount.currency_code !== "USD" || captureAmount.value !== expected.amount || merchantId !== expected.merchantId || typeof capture.id !== "string") {
    throw new Error("Capture PayPal tidak cocok dengan merchant atau nominal pesanan.");
  }
  return { captureId: capture.id, amount: captureAmount.value as string, currency: "USD", merchantId } satisfies PayPalCaptureEvidence;
}

export function paypalWebhookOrderId(event: unknown) {
  const root = record(event);
  if (typeof root.id !== "string" || typeof root.event_type !== "string") throw new Error("Webhook PayPal tidak valid.");
  const resource = record(root.resource);
  const supplementary = record(resource.supplementary_data);
  const related = record(supplementary.related_ids);
  if (typeof related.order_id !== "string") throw new Error("Webhook PayPal tidak memiliki referensi order.");
  return { eventId: root.id, eventType: root.event_type, paypalOrderId: related.order_id };
}

export function paypalCaptureNeedsReview(input: { orderStatus: string; paymentStatus: string; createdAt: Date; now?: Date }) {
  return input.orderStatus === "CANCELLED" || input.paymentStatus === "CANCELLED" ||
    input.orderStatus !== "PENDING" || input.paymentStatus !== "PENDING" ||
    input.now !== undefined && input.now.getTime() >= input.createdAt.getTime() + 10 * 60 * 1000;
}
