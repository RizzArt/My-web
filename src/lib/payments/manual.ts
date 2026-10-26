import type { PaymentStatus } from "@prisma/client";
import type { PaymentProvider, PaymentRequest, PaymentSession, PaymentWebhookEvent } from "./types";

/** Development provider: creates no external payment session or network request. */
export class ManualPaymentProvider implements PaymentProvider {
  constructor(private readonly providerName = "MANUAL") {}

  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    return { providerTransactionId: `${this.providerName.toLowerCase()}:${request.orderNumber}`, redirectUrl: `/payment/${request.orderNumber}` };
  }

  async getPaymentStatus(): Promise<PaymentStatus> {
    throw new Error("Manual payments are completed by an admin");
  }

  handleWebhook(): PaymentWebhookEvent {
    throw new Error("Manual payments do not accept provider webhooks");
  }

  async cancelPayment(): Promise<void> {
    // There is no external payment to cancel.
  }
}
