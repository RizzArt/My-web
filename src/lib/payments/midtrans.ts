import crypto from "node:crypto";
import type { PaymentStatus } from "@prisma/client";
import type { PaymentProvider, PaymentRequest, PaymentSession, PaymentWebhookEvent } from "./types";

type MidtransNotification = { order_id: string; transaction_id: string; transaction_status: string; fraud_status?: string; status_code: string; gross_amount: string; signature_key: string; [key: string]: unknown };
type MidtransCreateResponse = { token: string; redirect_url: string };

function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function isProduction() { return process.env.MIDTRANS_IS_PRODUCTION === "true"; }
function baseUrl() { return isProduction() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com"; }
function authHeader() { return `Basic ${Buffer.from(`${requiredEnv("MIDTRANS_SERVER_KEY")}:`).toString("base64")}`; }

function mapStatus(notification: MidtransNotification): PaymentStatus {
  if (notification.transaction_status === "settlement" || (notification.transaction_status === "capture" && notification.fraud_status !== "deny")) return "PAID";
  if (notification.transaction_status === "expire") return "EXPIRED";
  if (notification.transaction_status === "cancel") return "CANCELLED";
  if (notification.transaction_status === "deny") return "FAILED";
  if (notification.transaction_status === "refund" || notification.transaction_status === "partial_refund") return "REFUNDED";
  return "PENDING";
}

export class MidtransProvider implements PaymentProvider {
  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    const response = await fetch(`${baseUrl()}/snap/v1/transactions`, { method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/json" }, body: JSON.stringify({ transaction_details: { order_id: request.orderNumber, gross_amount: request.amount }, item_details: request.items.map((item) => ({ id: item.id, price: item.price, quantity: item.quantity, name: item.name.slice(0, 50) })), customer_details: { first_name: request.customer.name, email: request.customer.email }, callbacks: { finish: `${process.env.AUTH_URL ?? "http://localhost:3000"}/payment/${request.orderNumber}` } }) });
    if (!response.ok) throw new Error(`Midtrans create payment failed: ${response.status}`);
    const data = await response.json() as MidtransCreateResponse;
    return { providerTransactionId: request.orderNumber, redirectUrl: data.redirect_url || `https://app${isProduction() ? "" : ".sandbox"}.midtrans.com/snap/v2/vtweb/${data.token}` };
  }

  async getPaymentStatus(providerTransactionId: string): Promise<PaymentStatus> {
    const response = await fetch(`${baseUrl()}/v2/${encodeURIComponent(providerTransactionId)}/status`, { headers: { Authorization: authHeader() }, cache: "no-store" });
    if (!response.ok) throw new Error(`Midtrans status lookup failed: ${response.status}`);
    const data = await response.json() as MidtransNotification;
    return mapStatus(data);
  }

  handleWebhook(rawBody: string, signature?: string | null): PaymentWebhookEvent {
    const notification = JSON.parse(rawBody) as MidtransNotification;
    const expected = crypto.createHash("sha512").update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${requiredEnv("MIDTRANS_SERVER_KEY")}`).digest("hex");
    const supplied = signature || notification.signature_key;
    if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new Error("Invalid Midtrans webhook signature");
    return { provider: "midtrans", providerEventId: `${notification.transaction_id}:${notification.transaction_status}:${notification.status_code}`, providerTransactionId: notification.transaction_id, orderNumber: notification.order_id, status: mapStatus(notification), amount: Number(notification.gross_amount), eventType: notification.transaction_status, payload: notification as Record<string, unknown> };
  }

  async cancelPayment(providerTransactionId: string): Promise<void> {
    const response = await fetch(`${baseUrl()}/v2/${encodeURIComponent(providerTransactionId)}/cancel`, { method: "POST", headers: { Authorization: authHeader() } });
    if (!response.ok) throw new Error(`Midtrans cancel payment failed: ${response.status}`);
  }
}

export const paymentProvider: PaymentProvider = new MidtransProvider();
