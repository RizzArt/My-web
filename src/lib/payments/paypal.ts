import { paypalEligibleSellerId } from "./paypal-eligibility";

type PayPalConfig = {
  mode: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  merchantId: string;
  eligibleSellerId: string;
  webhookId: string;
  idrToUsdRate: string;
  baseUrl: string;
};

const productionStorageRoot = "/home/harnet/digital-store/storage";

const enabled = () => process.env.PAYPAL_ENABLED === "true";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Konfigurasi PayPal ${name} belum lengkap.`);
  return value;
}

export function paypalConfig(): PayPalConfig {
  if (!enabled()) throw new Error("PayPal belum diaktifkan.");
  const mode = process.env.PAYPAL_MODE;
  if (mode !== "sandbox" && mode !== "live") throw new Error("Mode PayPal harus sandbox atau live.");
  const idrToUsdRate = required("PAYPAL_IDR_PER_USD");
  parseRate(idrToUsdRate);
  return {
    mode,
    clientId: required("PAYPAL_CLIENT_ID"),
    clientSecret: required("PAYPAL_CLIENT_SECRET"),
    merchantId: required("PAYPAL_MERCHANT_ID"),
    eligibleSellerId: paypalEligibleSellerId(),
    webhookId: required("PAYPAL_WEBHOOK_ID"),
    idrToUsdRate,
    baseUrl: mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

export function paypalIsAvailable() {
  try {
    const config = paypalConfig();
    if (config.mode === "sandbox") assertPayPalSandboxStorage();
    return true;
  } catch { return false; }
}

export function assertPayPalSandboxStorage() {
  const sandboxStorage = required("PAYPAL_SANDBOX_STORAGE_ROOT");
  const configuredStorage = process.env.DIGITAL_STORAGE_ROOT?.trim();
  if (!configuredStorage || configuredStorage !== sandboxStorage || configuredStorage === productionStorageRoot) {
    throw new Error("PayPal Sandbox wajib memakai storage terisolasi, bukan storage produksi.");
  }
  return sandboxStorage;
}

// Client ID is public by design; the secret remains only in server-side calls.
export function paypalPublicConfig() {
  if (!paypalIsAvailable()) return { enabled: false };
  return { enabled: true, clientId: process.env.PAYPAL_CLIENT_ID!.trim(), currency: "USD" };
}

export function hasActivePayPalCheckout(payment: { provider?: string | null; externalId?: string | null } | null) {
  return payment?.provider === "PAYPAL" && payment.externalId?.startsWith("paypal:") === true;
}

function parseRate(rate: string) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(rate);
  if (!match || match[1] === "0") throw new Error("Kurs IDR/USD PayPal tidak valid.");
  const decimals = match[2] ?? "";
  let scale = BigInt(1);
  for (let index = 0; index < decimals.length; index += 1) scale *= BigInt(10);
  return { scaled: BigInt(match[1]) * scale + BigInt(decimals || "0"), scale };
}

export function usdAmountForIdr(idrAmount: number, idrToUsdRate: string) {
  if (!Number.isSafeInteger(idrAmount) || idrAmount < 1) throw new Error("Nominal IDR tidak valid.");
  const { scaled, scale } = parseRate(idrToUsdRate);
  // Round upward to cents so a configured rate never undercharges the IDR order.
  const one = BigInt(1);
  const hundred = BigInt(100);
  const numerator = BigInt(idrAmount) * hundred * scale;
  const cents = (numerator + scaled - one) / scaled;
  if (cents < one || cents > BigInt("99999999999")) throw new Error("Nominal USD di luar batas PayPal.");
  return `${cents / hundred}.${(cents % hundred).toString().padStart(2, "0")}`;
}

async function accessToken(config: PayPalConfig) {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !body?.access_token) throw new Error("Autentikasi PayPal gagal.");
  return body.access_token;
}

async function api(config: PayPalConfig, path: string, init: RequestInit = {}) {
  const token = await accessToken(config);
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("PayPal menolak permintaan pembayaran.");
  return body;
}

export async function createPayPalOrder(input: { requestId: string; orderNumber: string; orderId: string; amount: string }) {
  const config = paypalConfig();
  return api(config, "/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": input.requestId, Prefer: "return=representation" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: input.orderNumber, custom_id: input.orderId, amount: { currency_code: "USD", value: input.amount } }] }),
  });
}

export async function capturePayPalOrder(paypalOrderId: string) {
  const config = paypalConfig();
  return api(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST", headers: { "PayPal-Request-Id": `capture-${paypalOrderId}`, Prefer: "return=representation" }, body: "{}",
  });
}

export async function getPayPalOrder(paypalOrderId: string) {
  return api(paypalConfig(), `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export async function verifyPayPalWebhook(headers: Headers, webhookEvent: unknown) {
  const config = paypalConfig();
  const result = await api(config, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"), webhook_id: config.webhookId, webhook_event: webhookEvent,
    }),
  }) as { verification_status?: string };
  return result.verification_status === "SUCCESS";
}
