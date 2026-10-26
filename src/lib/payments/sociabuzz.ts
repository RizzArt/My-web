import type {
  PaymentProvider,
  PaymentRequest,
  PaymentSession,
  PaymentWebhookEvent,
} from "./types";
import { sociaBuzzSessionId } from "./sociabuzz-client";

export class SociaBuzzProvider implements PaymentProvider {
  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    // QR dibuat setelah pembeli memilih QRIS di halaman pembayaran.
    return {
      providerTransactionId: `scbz_draft:${sociaBuzzSessionId(request.orderId)}`,
      redirectUrl: `/payment/${encodeURIComponent(request.orderNumber)}`,
    };
  }

  async getPaymentStatus(): Promise<never> {
    throw new Error("Verifikasi SociaBuzz memerlukan identitas pesanan.");
  }

  handleWebhook(): PaymentWebhookEvent {
    throw new Error("SociaBuzz diverifikasi melalui gateway privat.");
  }

  async cancelPayment(): Promise<never> {
    throw new Error("Status invoice harus diperiksa sebelum pembatalan.");
  }
}
