export const SEKAI_MODELS_URL = "https://api.sekaigateway.xyz/v1/models";
export const SEKAI_QUOTA_URL = "https://api.sekaigateway.xyz/api/quota";

const HEALTH_TIMEOUT_MS = 10_000;
const MAX_HEALTH_RESPONSE_BYTES = 512 * 1024;
const MAX_PAYG_BALANCE_RUPIAH = 1_000_000_000_000;
type FetchLike = typeof fetch;
type ProbeFailure = { ok: false; hard: boolean; reasonCode: string };
export type SekaiProviderHealthProbe =
  | { ok: true; modelIds: string[]; entitledModelIds: string[] | null; paygBalanceRupiah: number }
  | ProbeFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function cancelBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* best effort */ }
}

async function readJsonWithLimit(response: Response) {
  const declared = response.headers.get("content-length");
  if (declared && /^\d{1,12}$/.test(declared) && Number(declared) > MAX_HEALTH_RESPONSE_BYTES) {
    await cancelBody(response);
    throw new Error("oversized");
  }
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HEALTH_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new Error("oversized");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    try { await reader.cancel(); } catch { /* best effort */ }
    throw error;
  }
}

function statusFailure(status: number): ProbeFailure {
  if (status === 401 || status === 403) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_AUTH" };
  if (status === 402) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" };
  return { ok: false, hard: false, reasonCode: status === 429 ? "AUTO_HEALTH_RATE_LIMIT" : "AUTO_HEALTH_UPSTREAM" };
}

function hasJsonContentType(response: Response) {
  const value = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return value === "application/json" || Boolean(value && /^application\/[a-z0-9.+-]+\+json$/.test(value));
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 200)) return null;
  return value as string[];
}

export async function probeSekaiProviderHealth(input: { fetch?: FetchLike; apiKey: string; minimumPaygBalanceRupiah: number }): Promise<SekaiProviderHealthProbe> {
  const fetcher = input.fetch ?? fetch;
  if (!input.apiKey.trim()) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_AUTH" };
  if (!Number.isFinite(input.minimumPaygBalanceRupiah) || input.minimumPaygBalanceRupiah < 0) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_CONFIG" };

  const [quotaResult, modelsResult] = await Promise.allSettled([
    fetcher(SEKAI_QUOTA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: input.apiKey }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    }),
    fetcher(SEKAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    }),
  ]);
  const quotaResponse = quotaResult.status === "fulfilled" ? quotaResult.value : null;
  const modelsResponse = modelsResult.status === "fulfilled" ? modelsResult.value : null;
  const failures = [quotaResponse, modelsResponse].flatMap((response) => response && !response.ok ? [statusFailure(response.status)] : []);
  if (!quotaResponse || !modelsResponse || failures.length > 0) {
    await Promise.all([quotaResponse ? cancelBody(quotaResponse) : Promise.resolve(), modelsResponse ? cancelBody(modelsResponse) : Promise.resolve()]);
    return failures.find((item) => item.hard) ?? failures[0] ?? { ok: false, hard: false, reasonCode: "AUTO_HEALTH_NETWORK" };
  }

  if (!hasJsonContentType(quotaResponse) || !hasJsonContentType(modelsResponse)) {
    await Promise.all([cancelBody(quotaResponse), cancelBody(modelsResponse)]);
    return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  }

  let quotaPayload: unknown;
  let modelsPayload: unknown;
  try {
    [quotaPayload, modelsPayload] = await Promise.all([readJsonWithLimit(quotaResponse), readJsonWithLimit(modelsResponse)]);
  } catch {
    return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  }

  if (!isRecord(quotaPayload) || typeof quotaPayload.status !== "string" || typeof quotaPayload.allModels !== "boolean" || !isRecord(quotaPayload.payg)) return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  if (quotaPayload.status === "inactive") return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_ACCOUNT_INACTIVE" };
  if (quotaPayload.status !== "active") return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  const payg = quotaPayload.payg;
  const paygBalance = payg.balance;
  if (typeof payg.enabled !== "boolean" || typeof payg.active !== "boolean") return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  if (payg.enabled !== true || payg.active !== true) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" };
  if (typeof paygBalance !== "number" || !Number.isFinite(paygBalance) || paygBalance < 0 || paygBalance > MAX_PAYG_BALANCE_RUPIAH) return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  if (paygBalance < input.minimumPaygBalanceRupiah) return { ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" };

  const quotaModels = quotaPayload.allModels ? null : stringArray(quotaPayload.models);
  if (!quotaPayload.allModels && !quotaModels) return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  if (!isRecord(modelsPayload) || modelsPayload.object !== "list" || !Array.isArray(modelsPayload.data)) return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
  const modelIds: string[] = [];
  for (const item of modelsPayload.data) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 200) return { ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" };
    modelIds.push(item.id);
  }
  return { ok: true, modelIds, entitledModelIds: quotaModels, paygBalanceRupiah: paygBalance };
}
