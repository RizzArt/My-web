import crypto from "node:crypto";

export type IpaymuMode = "sandbox" | "production";

export function ipaymuConfig() {
  const mode = process.env.IPAYMU_MODE ?? "sandbox";
  if (mode !== "sandbox" && mode !== "production") {
    throw new Error("IPAYMU_MODE harus sandbox atau production.");
  }

  const va = process.env.IPAYMU_VA?.trim();
  const apiKey = process.env.IPAYMU_API_KEY?.trim();
  if (!va || !apiKey) {
    throw new Error("Konfigurasi iPaymu belum lengkap.");
  }

  return {
    mode: mode as IpaymuMode,
    va,
    apiKey,
    baseUrl: mode === "production"
      ? "https://my.ipaymu.com"
      : "https://sandbox.ipaymu.com",
  };
}

export function ipaymuSignature(
  method: "GET" | "POST",
  va: string,
  apiKey: string,
  jsonBody: string,
) {
  const bodyHash = crypto.createHash("sha256")
    .update(jsonBody).digest("hex");
  return crypto.createHmac("sha256", apiKey)
    .update(`${method}:${va}:${bodyHash}:${apiKey}`)
    .digest("hex");
}

type Endpoint =
  | "/api/v2/payment-channels"
  | "/api/v2/payment/direct"
  | "/api/v2/transaction";

export async function ipaymuRequest(
  method: "GET" | "POST",
  endpoint: Endpoint,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const valid = method === "GET"
    ? endpoint === "/api/v2/payment-channels"
    : ["/api/v2/payment/direct", "/api/v2/transaction"].includes(endpoint);
  if (!valid) throw new Error("Endpoint iPaymu tidak sesuai.");

  const config = ipaymuConfig();
  const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetch(config.baseUrl + endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        va: config.va,
        signature: ipaymuSignature(method, config.va, config.apiKey, body),
        timestamp: new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      },
      ...(method === "POST" ? { body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Koneksi iPaymu gagal; hasil permintaan belum dapat dipastikan.");
  }

  if (!response.ok) {
    throw new Error(`iPaymu menolak permintaan (HTTP ${response.status}).`);
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("Respons iPaymu tidak dapat dibaca.");
  }
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Format respons iPaymu tidak sesuai.");
  }

  const result = envelope as Record<string, unknown>;
  if (result.Status !== 200 || result.Success !== true || result.Data == null) {
    throw new Error("Permintaan iPaymu belum berhasil.");
  }
  return result.Data;
}
