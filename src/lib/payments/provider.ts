import type { PaymentProvider } from "./types";
import { SociaBuzzProvider } from "./sociabuzz";
import { ManualPaymentProvider } from "./manual";
import { MidtransProvider } from "./midtrans";
import { qrisIsAvailable } from "./qris";

export type PaymentProviderName = "manual" | "midtrans" | "qris_manual" | "sociabuzz";

export function paymentProviderName(): PaymentProviderName {
  const provider = (process.env.PAYMENT_PROVIDER ?? "midtrans").toLowerCase();
  if (provider === "manual" || provider === "development") return "manual";
  if (provider === "qris" || provider === "qris_manual") return "qris_manual";
  if (provider === "sociabuzz") return "sociabuzz";
  if (provider === "midtrans") return "midtrans";
  throw new Error(`Unsupported payment provider: ${provider}`);
}

export function isManualPaymentEnabled() {
  return paymentProviderName() === "manual";
}

export function isQrisManualPaymentEnabled() {
  return paymentProviderName() === "qris_manual";
}

export function isManualPaymentActionEnabled() {
  const productionTestMode = process.env.NODE_ENV === "production" && process.env.MANUAL_PAYMENT_TEST_MODE === "true" && Boolean(process.env.MANUAL_PAYMENT_TEST_TOKEN);
  return (paymentProviderName() === "qris_manual" && qrisIsAvailable()) || (isManualPaymentEnabled() && (process.env.NODE_ENV !== "production" || productionTestMode));
}

export function customerPaymentsAvailable() {
  if (paymentProviderName() === "sociabuzz") {
    return process.env.SCBZ_GATEWAY_URL === "http://127.0.0.1:8011" && (process.env.SCBZ_GATEWAY_KEY?.length ?? 0) >= 32;
  }
  if (paymentProviderName() === "qris_manual") return qrisIsAvailable();
  if (process.env.NODE_ENV !== "production") return true;
  if (isManualPaymentEnabled()) return process.env.MANUAL_PAYMENT_TEST_MODE === "true";
  return Boolean(process.env.MIDTRANS_SERVER_KEY);
}

export function getPaymentProvider(): PaymentProvider {
  if (paymentProviderName() === "sociabuzz") return new SociaBuzzProvider();
  if (paymentProviderName() === "qris_manual") return new ManualPaymentProvider("QRIS_MANUAL");
  return isManualPaymentEnabled() ? new ManualPaymentProvider() : new MidtransProvider();
}
