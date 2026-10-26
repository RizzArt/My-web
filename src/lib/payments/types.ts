import type { PaymentStatus } from "@prisma/client";

export type PaymentRequest = {
  orderId: string;
  orderNumber: string;
  amount: number;
  customer: { name: string; email: string };
  items: Array<{ id: string; name: string; price: number; quantity: number }>;
};

export type PaymentSession = {
  providerTransactionId: string;
  redirectUrl: string;
};

export type PaymentWebhookEvent = {
  provider: string;
  providerEventId: string;
  providerTransactionId: string;
  orderNumber: string;
  status: PaymentStatus;
  amount: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<PaymentSession>;
  getPaymentStatus(providerTransactionId: string): Promise<PaymentStatus>;
  handleWebhook(rawBody: string, signature?: string | null): PaymentWebhookEvent;
  cancelPayment(providerTransactionId: string): Promise<void>;
}
