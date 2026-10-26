import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseApiKey, verifyApiKey } from "./api-keys";
import { calculateChargeMicros, calculateReservationMicros } from "./billing";
import { catalogModel } from "./catalog";
import { requestFingerprint, validateIdempotencyKey } from "./idempotency";
import { finalizeReservation, releaseReservation, reserveBalance } from "./ledger-math";
import { SekaiChatProviderError } from "./providers/sekai-chat";
import { GriphubChatProvider } from "./providers/griphub-chat";
import { customerBillingProviderAdmitted } from "./provider-policy";
import { estimateInputTokenUpperBound, type ParsedChatRequest } from "./validation";
import { acquireAiApiProviderAdmissionLock } from "./provider-health";
import { decryptAiApiResponseReplay, encryptAiApiResponseReplay } from "./response-replay";

export type AiApiEndpoint = "chat.completions" | "responses";
const MAX_SERIALIZABLE_ATTEMPTS = 3;
const DISPATCH_SERIALIZABLE_TIMEOUT_MS = 20_000;
const BLOCKING_BILLING_STATUSES = ["DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] as const;
let aiApiAdmissionQuarantined = false;

export type AuthenticatedKey = { id: string; walletId: string; dailySpendLimitMicros: bigint; rateLimitPerMinute: number; concurrencyLimit: number };
type Provider = Pick<GriphubChatProvider, "complete">;

export class AiApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId?: string;
  readonly requestStatus?: string;
  constructor(code: string, message: string, httpStatus: number, detail: { requestId?: string; requestStatus?: string } = {}) {
    super(message);
    this.name = "AiApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = detail.requestId;
    this.requestStatus = detail.requestStatus;
  }
}

function retryable(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // Raw SELECT ... FOR UPDATE reports PostgreSQL serialization/deadlock
  // failures as P2010, not necessarily the ORM's P2034 wrapper.
  return error.code === "P2034" || error.code === "P2002"
    || (error.code === "P2010" && (error.meta?.code === "40001" || error.meta?.code === "40P01"));
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { timeout?: number } = {}) {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: options.timeout });
    } catch (error) {
      if (!retryable(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) throw error;
    }
  }
  throw new AiApiError("storage_conflict", "Sistem billing sedang sibuk.", 503);
}

function utcDate(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function minuteWindow(now: Date) {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

function activePriceWhere(now: Date): Prisma.AiApiPriceVersionWhereInput {
  return { verifiedAt: { not: null }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] };
}

function modelMatchesCatalog(model: { provider: string; upstreamModelId: string; maxInputTokens: number; maxOutputTokens: number; privateBetaMaxOutputTokens: number; maxRequestBytes: number }, expectedCatalogModel: NonNullable<ReturnType<typeof catalogModel>>) {
  return model.provider === expectedCatalogModel.provider
    && model.upstreamModelId === expectedCatalogModel.upstreamModelId
    && model.maxInputTokens === expectedCatalogModel.providerMaxInputTokens
    && model.maxOutputTokens === expectedCatalogModel.providerMaxOutputTokens
    && model.privateBetaMaxOutputTokens === expectedCatalogModel.privateBetaMaxOutputTokens
    && model.maxRequestBytes === expectedCatalogModel.maxRequestBytes;
}


export function bearerApiKey(request: Request) {
  const value = parseApiKey(request.headers.get("authorization"));
  if (!value) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401);
  return value;
}

export async function authenticateAiApiKey(plaintext: string, now = new Date()): Promise<AuthenticatedKey> {
  const prefix = plaintext.slice(0, 16);
  const candidates = await prisma.aiApiKey.findMany({
    where: { prefix, status: "ACTIVE" },
    select: { id: true, walletId: true, secretHash: true, expiresAt: true, dailySpendLimitMicros: true, rateLimitPerMinute: true, concurrencyLimit: true, wallet: { select: { isFrozen: true, user: { select: { isActive: true } } } } },
    take: 8,
  });
  const matched = candidates.find((candidate) => verifyApiKey(plaintext, candidate.secretHash));
  if (!matched || matched.wallet.isFrozen || matched.wallet.user?.isActive !== true || (matched.expiresAt && matched.expiresAt <= now)) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401);
  return { id: matched.id, walletId: matched.walletId, dailySpendLimitMicros: matched.dailySpendLimitMicros, rateLimitPerMinute: matched.rateLimitPerMinute, concurrencyLimit: matched.concurrencyLimit };
}

export async function listAvailableAiApiModels(now = new Date()) {
  if (aiApiAdmissionQuarantined) return [];
  const models = await prisma.aiApiModel.findMany({
    where: { enabled: true, providerHealth: { breakerState: "CLOSED", healthyUntil: { gt: now } }, prices: { some: activePriceWhere(now) }, requests: { none: { status: { in: [...BLOCKING_BILLING_STATUSES] } } } },
    include: { prices: { where: activePriceWhere(now), orderBy: { effectiveFrom: "desc" }, take: 2 } },
    orderBy: { publicId: "asc" },
  });
  return models.filter((model) => {
    const expectedCatalogModel = catalogModel(model.publicId);
    return model.prices.length === 1
      && expectedCatalogModel
      && customerBillingProviderAdmitted(model.provider)
      && modelMatchesCatalog(model, expectedCatalogModel);
  }).map((model) => ({ id: model.publicId, object: "model", created: Math.floor(model.createdAt.getTime() / 1000), owned_by: "riezz99" }));
}

export async function acquireAiApiIngressAdmission(auth: AuthenticatedKey, now = new Date()) {
  if (aiApiAdmissionQuarantined) throw new AiApiError("billing_state_unconfirmed", "AI API sementara ditutup untuk verifikasi billing.", 503);
  return serializable(async (tx) => {
    const key = await tx.aiApiKey.findUnique({ where: { id: auth.id }, include: { wallet: { include: { user: { select: { isActive: true } } } } } });
    if (!key || key.status !== "ACTIVE" || key.walletId !== auth.walletId || key.wallet.isFrozen || key.wallet.user?.isActive !== true || (key.expiresAt && key.expiresAt <= now)) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401);
    const [keyExecution, walletExecution, keyIngress, walletIngress] = await Promise.all([
      tx.aiApiConcurrencyLease.count({ where: { apiKeyId: key.id, releasedAt: null, expiresAt: { gt: now } } }),
      tx.aiApiConcurrencyLease.count({ where: { walletId: key.walletId, releasedAt: null, expiresAt: { gt: now } } }),
      tx.aiApiIngressLease.count({ where: { apiKeyId: key.id, releasedAt: null, expiresAt: { gt: now } } }),
      tx.aiApiIngressLease.count({ where: { walletId: key.walletId, releasedAt: null, expiresAt: { gt: now } } }),
    ]);
    if (keyExecution + keyIngress >= key.concurrencyLimit || walletExecution + walletIngress >= key.wallet.concurrencyLimit) throw new AiApiError("concurrency_limit_exceeded", "Batas request bersamaan tercapai.", 429);
    const windowStart = minuteWindow(now);
    const [rate, walletRate] = await Promise.all([
      tx.aiApiRateWindow.findUnique({ where: { apiKeyId_windowStart: { apiKeyId: key.id, windowStart } } }),
      tx.aiApiWalletRateWindow.findUnique({ where: { walletId_windowStart: { walletId: key.walletId, windowStart } } }),
    ]);
    if ((rate?.count ?? 0) >= key.rateLimitPerMinute || (walletRate?.count ?? 0) >= key.wallet.rateLimitPerMinute) throw new AiApiError("rate_limit_exceeded", "Rate limit tercapai.", 429);
    await tx.aiApiRateWindow.upsert({ where: { apiKeyId_windowStart: { apiKeyId: key.id, windowStart } }, create: { apiKeyId: key.id, windowStart, count: 1 }, update: { count: { increment: 1 } } });
    await tx.aiApiWalletRateWindow.upsert({ where: { walletId_windowStart: { walletId: key.walletId, windowStart } }, create: { walletId: key.walletId, windowStart, count: 1 }, update: { count: { increment: 1 } } });
    return tx.aiApiIngressLease.create({ data: { apiKeyId: key.id, walletId: key.walletId, acquiredAt: now, expiresAt: new Date(now.getTime() + 15_000) }, select: { id: true, expiresAt: true } });
  });
}

export async function releaseAiApiIngressAdmission(leaseId: string, now = new Date()) {
  await prisma.aiApiIngressLease.updateMany({ where: { id: leaseId, releasedAt: null }, data: { releasedAt: now } });
}

async function currentAiApiAuthority(db: Pick<Prisma.TransactionClient, "aiApiKey">, auth: AuthenticatedKey, at?: Date) {
  const key = await db.aiApiKey.findUnique({ where: { id: auth.id }, include: { wallet: { include: { user: { select: { isActive: true } } } } } });
  const now = at ?? new Date();
  if (!key || key.status !== "ACTIVE" || key.walletId !== auth.walletId || key.wallet.isFrozen || key.wallet.user?.isActive !== true || (key.expiresAt && key.expiresAt <= now)) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401);
  return key;
}

export async function reserveAiApiRequest(input: { auth: AuthenticatedKey; request: ParsedChatRequest; endpoint?: AiApiEndpoint; idempotencyKey: string; fingerprint: string; ingressLeaseId?: string; now?: Date; inputTokenUpperBound?: bigint }) {
  if (aiApiAdmissionQuarantined) throw new AiApiError("billing_state_unconfirmed", "AI API sementara ditutup untuk verifikasi billing.", 503);
  const now = input.now ?? new Date();
  const endpoint = input.endpoint ?? "chat.completions";
  const expectedCatalogModel = catalogModel(input.request.model);
  if (!expectedCatalogModel) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503);
  const requestId = randomUUID();
  const upstreamIdempotencyKey = `riezz99-${requestId}`;
  return serializable(async (tx) => {
    const existing = await tx.aiApiRequest.findUnique({ where: { apiKeyId_endpoint_idempotencyKey: { apiKeyId: input.auth.id, endpoint, idempotencyKey: input.idempotencyKey } }, select: { id: true, requestFingerprint: true, status: true } });
    // Historical identity lookup stays before model admission, but replay/status
    // is still subject to CURRENT key, wallet and owner authorization.
    const key = await currentAiApiAuthority(tx, input.auth, input.now);
    if (existing) {
      if (existing.requestFingerprint !== input.fingerprint) throw new AiApiError("idempotency_conflict", "Idempotency-Key sudah digunakan untuk request berbeda.", 409, { requestId: existing.id, requestStatus: existing.status });
      return { duplicate: true as const, id: existing.id, status: existing.status };
    }

    const model = await tx.aiApiModel.findUnique({
      where: { publicId: input.request.model },
      include: { providerHealth: true, prices: { where: activePriceWhere(now), orderBy: { effectiveFrom: "desc" }, take: 2 } },
    });
    if (!model || !customerBillingProviderAdmitted(model.provider) || !modelMatchesCatalog(model, expectedCatalogModel) || !model.enabled || model.prices.length !== 1 || !model.providerHealth || model.providerHealth.breakerState !== "CLOSED" || !model.providerHealth.healthyUntil || model.providerHealth.healthyUntil <= now) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503);
    const blockingBillingRequests = await tx.aiApiRequest.count({ where: { modelId: model.id, status: { in: [...BLOCKING_BILLING_STATUSES] } } });
    if (blockingBillingRequests > 0) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503);
    const price = model.prices[0];
    const reservation = calculateReservationMicros({ inputTokenUpperBound: input.inputTokenUpperBound ?? estimateInputTokenUpperBound(input.request.messages), maxCompletionTokens: BigInt(input.request.maxCompletionTokens), inputMicrosPerMillion: price.retailInputMicrosPerMillion, outputMicrosPerMillion: price.retailOutputMicrosPerMillion, minimumChargeMicros: price.retailMinimumMicros });
    if (reservation <= BigInt(0)) throw new AiApiError("invalid_reservation", "Reservasi biaya tidak valid.", 500);

    const day = utcDate(now);
    const [daily, keyDaily] = await Promise.all([
      tx.aiApiDailyUsage.findUnique({ where: { walletId_usageDate: { walletId: key.walletId, usageDate: day } } }),
      tx.aiApiKeyDailyUsage.findUnique({ where: { apiKeyId_usageDate: { apiKeyId: key.id, usageDate: day } } }),
    ]);
    const projectedWalletDaily = (daily?.reservedMicros ?? BigInt(0)) + (daily?.spentMicros ?? BigInt(0)) + reservation;
    const projectedKeyDaily = (keyDaily?.reservedMicros ?? BigInt(0)) + (keyDaily?.spentMicros ?? BigInt(0)) + reservation;
    if (projectedKeyDaily > key.dailySpendLimitMicros || projectedWalletDaily > key.wallet.dailySpendLimitMicros) throw new AiApiError("daily_limit_exceeded", "Batas pengeluaran harian tercapai.", 429);
    const windowStart = minuteWindow(now);
    if (input.ingressLeaseId) {
      const ingress = await tx.aiApiIngressLease.findFirst({ where: { id: input.ingressLeaseId, apiKeyId: key.id, walletId: key.walletId, releasedAt: null, expiresAt: { gt: now } }, select: { id: true } });
      if (!ingress) throw new AiApiError("ingress_admission_expired", "Waktu penerimaan request habis.", 408);
    } else {
      const [keyActiveLeases, walletActiveLeases, keyIngress, walletIngress] = await Promise.all([
        tx.aiApiConcurrencyLease.count({ where: { apiKeyId: key.id, releasedAt: null, expiresAt: { gt: now } } }),
        tx.aiApiConcurrencyLease.count({ where: { walletId: key.walletId, releasedAt: null, expiresAt: { gt: now } } }),
        tx.aiApiIngressLease.count({ where: { apiKeyId: key.id, releasedAt: null, expiresAt: { gt: now } } }),
        tx.aiApiIngressLease.count({ where: { walletId: key.walletId, releasedAt: null, expiresAt: { gt: now } } }),
      ]);
      if (keyActiveLeases + keyIngress >= key.concurrencyLimit || walletActiveLeases + walletIngress >= key.wallet.concurrencyLimit) throw new AiApiError("concurrency_limit_exceeded", "Batas request bersamaan tercapai.", 429);
      const [rate, walletRate] = await Promise.all([
        tx.aiApiRateWindow.findUnique({ where: { apiKeyId_windowStart: { apiKeyId: key.id, windowStart } } }),
        tx.aiApiWalletRateWindow.findUnique({ where: { walletId_windowStart: { walletId: key.walletId, windowStart } } }),
      ]);
      if ((rate?.count ?? 0) >= key.rateLimitPerMinute || (walletRate?.count ?? 0) >= key.wallet.rateLimitPerMinute) throw new AiApiError("rate_limit_exceeded", "Rate limit tercapai.", 429);
    }

    const balance = reserveBalance(key.wallet, reservation);
    const sequence = key.wallet.ledgerSequence + BigInt(1);
    await tx.aiApiRequest.create({ data: { id: requestId, walletId: key.walletId, apiKeyId: key.id, modelId: model.id, priceVersionId: price.id, endpoint, idempotencyKey: input.idempotencyKey, requestFingerprint: input.fingerprint, reservedMicros: reservation, upstreamIdempotencyKey, admissionDate: day } });
    await tx.aiApiWallet.update({ where: { id: key.walletId }, data: { availableMicros: balance.availableMicros, reservedMicros: balance.reservedMicros, ledgerSequence: sequence } });
    await tx.aiApiLedgerEntry.create({ data: { walletId: key.walletId, requestId, sequence, kind: "RESERVE", eventKey: `request:${requestId}:reserve`, availableDeltaMicros: balance.availableDeltaMicros, reservedDeltaMicros: balance.reservedDeltaMicros, availableAfterMicros: balance.availableMicros, reservedAfterMicros: balance.reservedMicros } });
    await tx.aiApiDailyUsage.upsert({ where: { walletId_usageDate: { walletId: key.walletId, usageDate: day } }, create: { walletId: key.walletId, usageDate: day, reservedMicros: reservation, admittedRequestCount: BigInt(1) }, update: { reservedMicros: { increment: reservation }, admittedRequestCount: { increment: BigInt(1) } } });
    await tx.aiApiKeyDailyUsage.upsert({ where: { apiKeyId_usageDate: { apiKeyId: key.id, usageDate: day } }, create: { apiKeyId: key.id, walletId: key.walletId, usageDate: day, reservedMicros: reservation, admittedRequestCount: BigInt(1) }, update: { reservedMicros: { increment: reservation }, admittedRequestCount: { increment: BigInt(1) } } });
    if (!input.ingressLeaseId) {
      await tx.aiApiRateWindow.upsert({ where: { apiKeyId_windowStart: { apiKeyId: key.id, windowStart } }, create: { apiKeyId: key.id, windowStart, count: 1 }, update: { count: { increment: 1 } } });
      await tx.aiApiWalletRateWindow.upsert({ where: { walletId_windowStart: { walletId: key.walletId, windowStart } }, create: { walletId: key.walletId, windowStart, count: 1 }, update: { count: { increment: 1 } } });
    }
    await tx.aiApiConcurrencyLease.create({ data: { requestId, apiKeyId: key.id, walletId: key.walletId, acquiredAt: now, expiresAt: new Date(now.getTime() + (model.maxExecutionSeconds + 30) * 1_000) } });
    if (input.ingressLeaseId) await tx.aiApiIngressLease.update({ where: { id: input.ingressLeaseId }, data: { releasedAt: now } });
    await tx.aiApiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
    return { duplicate: false as const, id: requestId, status: "RESERVED" as const, upstreamIdempotencyKey, reservation, upstreamModelId: model.upstreamModelId, provider: model.provider };
  });
}

export async function markAiApiDispatching(requestId: string, now?: Date) {
  if (aiApiAdmissionQuarantined) throw new AiApiError("billing_state_unconfirmed", "AI API sementara ditutup untuk verifikasi billing.", 503, { requestId });
  return serializable(async (tx) => {
    await acquireAiApiProviderAdmissionLock(tx);
    const admissionNow = now ?? new Date();
    const request = await tx.aiApiRequest.findUnique({ where: { id: requestId }, include: { model: { include: { providerHealth: true } } } });
    if (!request) throw new AiApiError("request_not_found", "Request tidak ditemukan.", 404, { requestId });
    if (request.status !== "RESERVED") throw new AiApiError("invalid_request_state", "State request tidak valid.", 409, { requestId, requestStatus: request.status });
    const health = request.model.providerHealth;
    if (!customerBillingProviderAdmitted(request.model.provider) || !request.model.enabled || !health || health.breakerState !== "CLOSED" || !health.healthyUntil || health.healthyUntil <= admissionNow) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503, { requestId, requestStatus: request.status });
    const blockingBillingRequests = await tx.aiApiRequest.count({ where: { modelId: request.modelId, id: { not: request.id }, status: { in: [...BLOCKING_BILLING_STATUSES] } } });
    if (blockingBillingRequests > 0) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503, { requestId, requestStatus: request.status });
    // Lock the credential authority in wallet -> key -> owner order. A row
    // changed while waiting under SERIALIZABLE forces retry instead of using
    // an old admission snapshot. Wallet-first matches reservation lock order.
    const walletRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AiApiWallet" WHERE "id" = ${request.walletId} FOR UPDATE`;
    const keyRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AiApiKey" WHERE "id" = ${request.apiKeyId} AND "walletId" = ${request.walletId} FOR UPDATE`;
    const ownerRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT u."id" FROM "User" AS u JOIN "AiApiWallet" AS w ON w."userId" = u."id" WHERE w."id" = ${request.walletId} FOR UPDATE OF u`;
    if (walletRows.length !== 1 || walletRows[0].id !== request.walletId || keyRows.length !== 1 || keyRows[0].id !== request.apiKeyId || ownerRows.length !== 1) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401, { requestId, requestStatus: request.status });
    const key = await tx.aiApiKey.findUnique({ where: { id: request.apiKeyId }, include: { wallet: { include: { user: { select: { isActive: true } } } } } });
    const dispatchNow = now ?? new Date();
    if (!key || key.status !== "ACTIVE" || key.walletId !== request.walletId || key.wallet.isFrozen || key.wallet.user?.isActive !== true || (key.expiresAt && key.expiresAt <= dispatchNow)) throw new AiApiError("invalid_api_key", "API key tidak valid.", 401, { requestId, requestStatus: request.status });
    if (health.healthyUntil <= dispatchNow) throw new AiApiError("model_unavailable", "Model sedang tidak tersedia.", 503, { requestId, requestStatus: request.status });
    const claimed = await tx.aiApiRequest.updateMany({ where: { id: requestId, status: "RESERVED" }, data: { status: "DISPATCHING", dispatchStartedAt: dispatchNow } });
    if (claimed.count !== 1) throw new AiApiError("invalid_request_state", "State request tidak valid.", 409, { requestId });
  }, { timeout: DISPATCH_SERIALIZABLE_TIMEOUT_MS });
}

export async function finalizeAiApiRequest(input: { requestId: string; promptTokens?: bigint; completionTokens?: bigint; providerRequestId?: string; responseReplayCiphertext?: string; responseReplayExpiresAt?: Date; now?: Date; recoveryOnly?: boolean; actorId?: string; auditReason?: string }) {
  const now = input.now ?? new Date();
  const outcome = await serializable(async (tx) => {
    const request = await tx.aiApiRequest.findUnique({ where: { id: input.requestId }, include: { wallet: true, priceVersion: true } });
    if (!request) throw new AiApiError("request_not_found", "Request tidak ditemukan.", 404, { requestId: input.requestId });
    if (input.recoveryOnly) {
      if (!input.actorId) throw new AiApiError("recovery_actor_required", "Admin recovery wajib memiliki actor.", 403, { requestId: request.id, requestStatus: request.status });
      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
      if (!actor?.isActive || actor.role !== "ADMIN") throw new AiApiError("recovery_actor_invalid", "Admin recovery tidak valid.", 403, { requestId: request.id, requestStatus: request.status });
    }
    if (request.status === "COMPLETED") {
      if (!request.providerRequestId) throw new AiApiError("authoritative_provider_identity_required", "Provider request ID authoritative belum tersedia.", 409, { requestId: request.id, requestStatus: request.status });
      if (request.promptTokens === null || request.completionTokens === null || (input.promptTokens !== undefined && input.promptTokens !== request.promptTokens) || (input.completionTokens !== undefined && input.completionTokens !== request.completionTokens)) throw new AiApiError("trusted_usage_mismatch", "trusted usage tidak cocok.", 409, { requestId: request.id, requestStatus: request.status });
      if (input.providerRequestId !== undefined && input.providerRequestId !== request.providerRequestId) throw new AiApiError("provider_request_id_mismatch", "Provider request ID tidak cocok.", 409, { requestId: request.id, requestStatus: request.status });
      return { kind: "completed" as const, duplicate: true as const, chargeMicros: request.finalChargeMicros ?? BigInt(0) };
    }
    const validState = input.recoveryOnly ? (request.status === "RECONCILIATION_REQUIRED" || request.status === "MANUAL_REVIEW") : request.status === "DISPATCHING";
    if (!validState) throw new AiApiError("invalid_request_state", "State request tidak valid.", 409, { requestId: request.id, requestStatus: request.status });
    let promptTokens = input.promptTokens;
    let completionTokens = input.completionTokens;
    if (input.recoveryOnly) {
      if (request.promptTokens === null || request.completionTokens === null) throw new AiApiError("authoritative_usage_required", "authoritative usage belum tersedia.", 409, { requestId: request.id, requestStatus: request.status });
      if (!request.providerRequestId) throw new AiApiError("authoritative_provider_identity_required", "Provider request ID authoritative belum tersedia.", 409, { requestId: request.id, requestStatus: request.status });
      if ((input.promptTokens !== undefined && input.promptTokens !== request.promptTokens) || (input.completionTokens !== undefined && input.completionTokens !== request.completionTokens)) throw new AiApiError("trusted_usage_mismatch", "trusted usage tidak cocok.", 409, { requestId: request.id, requestStatus: request.status });
      promptTokens = request.promptTokens;
      completionTokens = request.completionTokens;
    }
    if (promptTokens === undefined || completionTokens === undefined) throw new AiApiError("authoritative_usage_required", "authoritative usage belum tersedia.", 409, { requestId: request.id, requestStatus: request.status });
    if (request.providerRequestId && input.providerRequestId && input.providerRequestId !== request.providerRequestId) throw new AiApiError("provider_request_id_mismatch", "Provider request ID tidak cocok.", 409, { requestId: request.id, requestStatus: request.status });
    const providerRequestId = request.providerRequestId ?? input.providerRequestId;
    if (!providerRequestId) throw new AiApiError("authoritative_provider_identity_required", "Provider request ID authoritative belum tersedia.", 409, { requestId: request.id, requestStatus: request.status });
    const charge = calculateChargeMicros({ promptTokens, completionTokens, inputMicrosPerMillion: request.priceVersion.retailInputMicrosPerMillion, outputMicrosPerMillion: request.priceVersion.retailOutputMicrosPerMillion, minimumChargeMicros: request.priceVersion.retailMinimumMicros });
    const upstreamCost = calculateChargeMicros({ promptTokens, completionTokens, inputMicrosPerMillion: request.priceVersion.upstreamInputMicrosPerMillion, outputMicrosPerMillion: request.priceVersion.upstreamOutputMicrosPerMillion, minimumChargeMicros: request.priceVersion.upstreamMinimumMicros });
    if (charge > request.reservedMicros) {
      // Never debit beyond the reservation, including during admin recovery.
      // Preserve authoritative evidence for the existing reconciliation queue.
      await tx.aiApiRequest.update({ where: { id: request.id }, data: { status: "MANUAL_REVIEW", promptTokens, completionTokens, upstreamCostMicros: upstreamCost, providerRequestId, responseReplayCiphertext: input.responseReplayCiphertext, responseReplayExpiresAt: input.responseReplayExpiresAt, safeErrorCode: "CHARGE_EXCEEDS_RESERVATION" } });
      await tx.aiApiProviderHealth.update({ where: { modelId: request.modelId }, data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: { increment: 1 }, safeReasonCode: "CHARGE_EXCEEDS_RESERVATION" } });
      await tx.aiApiConcurrencyLease.updateMany({ where: { requestId: request.id, releasedAt: null }, data: { releasedAt: now } });
      return { kind: "manual_review" as const, requestId: request.id };
    }
    const balance = finalizeReservation(request.wallet, request.reservedMicros, charge);
    const sequence = request.wallet.ledgerSequence + BigInt(1);
    await tx.aiApiWallet.update({ where: { id: request.walletId }, data: { availableMicros: balance.availableMicros, reservedMicros: balance.reservedMicros, ledgerSequence: sequence } });
    await tx.aiApiLedgerEntry.create({ data: { walletId: request.walletId, requestId: request.id, sequence, kind: "FINALIZE", eventKey: `request:${request.id}:finalize`, availableDeltaMicros: balance.availableDeltaMicros, reservedDeltaMicros: balance.reservedDeltaMicros, availableAfterMicros: balance.availableMicros, reservedAfterMicros: balance.reservedMicros, actorId: input.actorId } });
    await tx.aiApiDailyUsage.update({ where: { walletId_usageDate: { walletId: request.walletId, usageDate: request.admissionDate } }, data: { reservedMicros: { decrement: request.reservedMicros }, spentMicros: { increment: charge } } });
    await tx.aiApiKeyDailyUsage.update({ where: { apiKeyId_usageDate: { apiKeyId: request.apiKeyId, usageDate: request.admissionDate } }, data: { reservedMicros: { decrement: request.reservedMicros }, spentMicros: { increment: charge } } });
    await tx.aiApiConcurrencyLease.updateMany({ where: { requestId: request.id, releasedAt: null }, data: { releasedAt: now } });
    await tx.aiApiRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", finalChargeMicros: charge, upstreamCostMicros: upstreamCost, promptTokens, completionTokens, providerRequestId, responseReplayCiphertext: input.responseReplayCiphertext, responseReplayExpiresAt: input.responseReplayExpiresAt, safeErrorCode: null, settledAt: now } });
    if (input.actorId) await tx.auditLog.create({ data: { actorId: input.actorId, action: "AI_API_REQUEST_RECONCILED", entityType: "AiApiRequest", entityId: request.id, metadata: { action: "FINALIZE_USAGE", chargeMicros: charge.toString(), promptTokens: promptTokens.toString(), completionTokens: completionTokens.toString(), reason: input.auditReason ?? null } } });
    await tx.aiApiProviderHealth.updateMany({ where: { modelId: request.modelId, breakerState: "CLOSED" }, data: { lastSuccessAt: now } });
    return { kind: "completed" as const, duplicate: false as const, chargeMicros: charge };
  });
  if (outcome.kind === "manual_review") throw new AiApiError("charge_exceeds_reservation", "Billing memerlukan review manual.", 503, { requestId: outcome.requestId, requestStatus: "MANUAL_REVIEW" });
  return { duplicate: outcome.duplicate, chargeMicros: outcome.chargeMicros };
}

export async function releaseAiApiRequest(requestId: string, safeErrorCode: string, now = new Date(), options: { recoveryOnly?: boolean; expectedStatus?: "RESERVED" | "DISPATCHING"; openBreaker?: boolean; actorId?: string; auditReason?: string; unbilledEvidenceReference?: string } = {}) {
  return serializable(async (tx) => {
    const request = await tx.aiApiRequest.findUnique({ where: { id: requestId }, include: { wallet: true } });
    if (!request) throw new AiApiError("request_not_found", "Request tidak ditemukan.", 404, { requestId });
    if (request.status === "FAILED_RELEASED") return { duplicate: true as const };
    if (options.expectedStatus && request.status !== options.expectedStatus) throw new AiApiError("invalid_request_state", "State request tidak valid.", 409, { requestId, requestStatus: request.status });
    const validState = options.recoveryOnly ? (request.status === "RECONCILIATION_REQUIRED" || request.status === "MANUAL_REVIEW") : (request.status === "RESERVED" || request.status === "DISPATCHING");
    if (!validState) throw new AiApiError("invalid_request_state", "State request tidak valid.", 409, { requestId, requestStatus: request.status });
    if (options.recoveryOnly) {
      if (!options.actorId) throw new AiApiError("recovery_actor_required", "Admin recovery wajib memiliki actor.", 403, { requestId, requestStatus: request.status });
      const actor = await tx.user.findUnique({ where: { id: options.actorId }, select: { role: true, isActive: true } });
      if (!actor?.isActive || actor.role !== "ADMIN") throw new AiApiError("recovery_actor_invalid", "Admin recovery tidak valid.", 403, { requestId, requestStatus: request.status });
    }
    if (options.recoveryOnly && ((request.promptTokens !== null && request.promptTokens !== undefined) || (request.completionTokens !== null && request.completionTokens !== undefined) || (request.responseReplayCiphertext !== null && request.responseReplayCiphertext !== undefined))) throw new AiApiError("authoritative_usage_requires_finalization", "Request memiliki bukti eksekusi dan harus difinalisasi.", 409, { requestId, requestStatus: request.status });
    if (options.recoveryOnly && !/^[A-Za-z0-9._:/-]{8,300}$/.test(options.unbilledEvidenceReference ?? "")) throw new AiApiError("unbilled_evidence_required", "Referensi bukti tidak tertagih wajib diisi.", 409, { requestId, requestStatus: request.status });
    const balance = releaseReservation(request.wallet, request.reservedMicros);
    const sequence = request.wallet.ledgerSequence + BigInt(1);
    await tx.aiApiWallet.update({ where: { id: request.walletId }, data: { availableMicros: balance.availableMicros, reservedMicros: balance.reservedMicros, ledgerSequence: sequence } });
    await tx.aiApiLedgerEntry.create({ data: { walletId: request.walletId, requestId: request.id, sequence, kind: "RELEASE", eventKey: `request:${request.id}:release`, availableDeltaMicros: balance.availableDeltaMicros, reservedDeltaMicros: balance.reservedDeltaMicros, availableAfterMicros: balance.availableMicros, reservedAfterMicros: balance.reservedMicros, safeReasonCode: safeErrorCode, actorId: options.actorId } });
    await tx.aiApiDailyUsage.update({ where: { walletId_usageDate: { walletId: request.walletId, usageDate: request.admissionDate } }, data: { reservedMicros: { decrement: request.reservedMicros } } });
    await tx.aiApiKeyDailyUsage.update({ where: { apiKeyId_usageDate: { apiKeyId: request.apiKeyId, usageDate: request.admissionDate } }, data: { reservedMicros: { decrement: request.reservedMicros } } });
    await tx.aiApiConcurrencyLease.updateMany({ where: { requestId: request.id, releasedAt: null }, data: { releasedAt: now } });
    if (options.openBreaker !== false) await tx.aiApiProviderHealth.update({ where: { modelId: request.modelId }, data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: { increment: 1 }, safeReasonCode: safeErrorCode } });
    await tx.aiApiRequest.update({ where: { id: request.id }, data: { status: "FAILED_RELEASED", finalChargeMicros: BigInt(0), safeErrorCode, settledAt: now } });
    if (options.actorId) await tx.auditLog.create({ data: { actorId: options.actorId, action: "AI_API_REQUEST_RECONCILED", entityType: "AiApiRequest", entityId: request.id, metadata: { action: "RELEASE_UNBILLED", reason: options.auditReason ?? null, unbilledEvidenceReference: options.unbilledEvidenceReference ?? null, safeErrorCode } } });
    return { duplicate: false as const };
  });
}

export async function markAiApiReconciliationRequired(requestId: string, safeErrorCode: string, options: { openBreaker?: boolean; now?: Date; providerRequestId?: string; promptTokens?: bigint; completionTokens?: bigint; responseReplayCiphertext?: string; responseReplayExpiresAt?: Date } = {}) {
  const now = options.now ?? new Date();
  await serializable(async (tx) => {
    const request = await tx.aiApiRequest.findUnique({ where: { id: requestId }, select: { status: true, modelId: true, providerRequestId: true, promptTokens: true, completionTokens: true, responseReplayCiphertext: true, responseReplayExpiresAt: true } });
    if (!request) return;
    if (request.status === "COMPLETED" || request.status === "FAILED_RELEASED" || request.status === "MANUAL_REVIEW") return;
    const hasUsage = options.promptTokens !== undefined || options.completionTokens !== undefined;
    if (hasUsage && (options.promptTokens === undefined || options.completionTokens === undefined)) throw new AiApiError("trusted_usage_incomplete", "Trusted usage tidak lengkap.", 500, { requestId, requestStatus: request.status });
    const hasStoredUsage = request.promptTokens != null || request.completionTokens != null;
    if (hasStoredUsage && (request.promptTokens == null || request.completionTokens == null)) throw new AiApiError("authoritative_evidence_mismatch", "Bukti authoritative tersimpan tidak konsisten.", 500, { requestId, requestStatus: request.status });
    const hasReplay = options.responseReplayCiphertext !== undefined || options.responseReplayExpiresAt !== undefined;
    if (hasReplay && (!options.responseReplayCiphertext || !options.responseReplayExpiresAt)) throw new AiApiError("trusted_replay_incomplete", "Replay authoritative tidak lengkap.", 500, { requestId, requestStatus: request.status });
    const hasStoredReplay = request.responseReplayCiphertext != null || request.responseReplayExpiresAt != null;
    if (hasStoredReplay && (!request.responseReplayCiphertext || !request.responseReplayExpiresAt)) throw new AiApiError("authoritative_evidence_mismatch", "Bukti authoritative tersimpan tidak konsisten.", 500, { requestId, requestStatus: request.status });
    const evidenceMismatch =
      (request.providerRequestId != null && options.providerRequestId !== undefined && options.providerRequestId !== request.providerRequestId)
      || (hasStoredUsage && hasUsage && (options.promptTokens !== request.promptTokens || options.completionTokens !== request.completionTokens))
      || (hasStoredReplay && hasReplay && (options.responseReplayCiphertext !== request.responseReplayCiphertext || options.responseReplayExpiresAt!.getTime() !== request.responseReplayExpiresAt!.getTime()));
    if (evidenceMismatch) throw new AiApiError("authoritative_evidence_mismatch", "Bukti authoritative tidak cocok.", 409, { requestId, requestStatus: request.status });
    await tx.aiApiRequest.update({ where: { id: requestId }, data: {
      status: "RECONCILIATION_REQUIRED",
      safeErrorCode,
      ...(request.providerRequestId == null && options.providerRequestId ? { providerRequestId: options.providerRequestId } : {}),
      ...(!hasStoredUsage && hasUsage ? { promptTokens: options.promptTokens, completionTokens: options.completionTokens } : {}),
      ...(!hasStoredReplay && hasReplay ? { responseReplayCiphertext: options.responseReplayCiphertext, responseReplayExpiresAt: options.responseReplayExpiresAt } : {}),
    } });
    await tx.aiApiConcurrencyLease.updateMany({ where: { requestId, releasedAt: null }, data: { releasedAt: now } });
    if (options.openBreaker !== false) await tx.aiApiProviderHealth.update({ where: { modelId: request.modelId }, data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: { increment: 1 }, safeReasonCode: safeErrorCode } });
  });
}

export async function emergencyQuarantineAiApiAdmission(_requestId: string, safeReasonCode: string) {
  aiApiAdmissionQuarantined = true;
  try {
    await prisma.aiApiProviderHealth.updateMany({
      where: { model: { enabled: true } },
      data: { breakerState: "OPEN", healthyUntil: null, safeReasonCode: safeReasonCode.slice(0, 200) },
    });
  } catch { /* in-process quarantine remains active until the unhealthy worker restarts */ }
}

async function persistReconciliationOrThrow(requestId: string, safeErrorCode: string, openBreaker: boolean, providerRequestId?: string, evidence: { promptTokens?: bigint; completionTokens?: bigint; responseReplayCiphertext?: string; responseReplayExpiresAt?: Date } = {}) {
  try {
    await markAiApiReconciliationRequired(requestId, safeErrorCode, { openBreaker, providerRequestId, ...evidence });
  } catch {
    await emergencyQuarantineAiApiAdmission(requestId, "BILLING_STATE_UNCONFIRMED");
    throw new AiApiError("billing_state_unconfirmed", "Status billing belum dapat disimpan dengan aman.", 503, { requestId, requestStatus: "DISPATCHING" });
  }
}

type ProviderResult = Awaited<ReturnType<Provider["complete"]>>;
type ProviderResponse = ProviderResult["response"];

type ExecuteChatInput<TResponse = ProviderResponse> = {
  request: ParsedChatRequest;
  idempotencyKey: string;
  provider?: Provider;
  ingressLeaseId?: string;
  endpoint?: AiApiEndpoint;
  fingerprintSource?: unknown;
  inputTokenUpperBound?: bigint;
  responseAdapter?: (input: { requestId: string; chatResponse: ProviderResponse }) => TResponse;
  replayCompletedResponse?: boolean;
} & ({ plaintextKey: string; auth?: never } | { auth: AuthenticatedKey; plaintextKey?: never });

async function completedAiApiResponseReplay(requestId: string, auth: AuthenticatedKey, at?: Date) {
  const request = await prisma.aiApiRequest.findFirst({
    where: { id: requestId, apiKeyId: auth.id, walletId: auth.walletId, status: "COMPLETED" },
    select: { id: true, apiKeyId: true, walletId: true, endpoint: true, requestFingerprint: true, finalChargeMicros: true, responseReplayCiphertext: true, responseReplayExpiresAt: true },
  });
  // This fresh, separate read is the replay authorization checkpoint: a ban,
  // revoke, freeze or expiry after the duplicate transaction must veto access.
  await currentAiApiAuthority(prisma, auth, at);
  const now = at ?? new Date();
  if (!request?.responseReplayCiphertext || !request.responseReplayExpiresAt) return null;
  try {
    return {
      requestId: request.id,
      chargeMicros: request.finalChargeMicros ?? BigInt(0),
      response: decryptAiApiResponseReplay(request.responseReplayCiphertext, request.responseReplayExpiresAt, {
        requestId: request.id,
        apiKeyId: request.apiKeyId,
        walletId: request.walletId,
        endpoint: request.endpoint,
        requestFingerprint: request.requestFingerprint,
      }, now),
    };
  } catch {
    return null;
  }
}

export async function executeAiApiChat<TResponse = ProviderResponse>(input: ExecuteChatInput<TResponse>) {
  const auth = input.auth ?? await authenticateAiApiKey(input.plaintextKey);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const fingerprint = requestFingerprint(input.fingerprintSource ?? input.request);
  let reserved: Awaited<ReturnType<typeof reserveAiApiRequest>>;
  try {
    reserved = await reserveAiApiRequest({ auth, request: input.request, endpoint: input.endpoint, idempotencyKey, fingerprint, ingressLeaseId: input.ingressLeaseId, inputTokenUpperBound: input.inputTokenUpperBound });
  } catch (error) {
    if (input.ingressLeaseId) {
      try { await releaseAiApiIngressAdmission(input.ingressLeaseId); } catch { /* lease expires fail-closed */ }
    }
    throw error;
  }
  if (reserved.duplicate) {
    if (input.replayCompletedResponse && reserved.status === "COMPLETED") {
      const replay = await completedAiApiResponseReplay(reserved.id, auth);
      if (replay) return { requestId: replay.requestId, chargeMicros: replay.chargeMicros, response: replay.response as TResponse, replayed: true as const };
    }
    throw new AiApiError("idempotent_replay_unavailable", "Request ini sudah pernah diterima, tetapi replay respons tidak tersedia.", 409, { requestId: reserved.id, requestStatus: reserved.status });
  }
  try {
    await markAiApiDispatching(reserved.id);
  } catch (error) {
    try {
      await releaseAiApiRequest(reserved.id, error instanceof AiApiError ? error.code : "PRE_DISPATCH_FAILURE", new Date(), { openBreaker: false });
    } catch {
      await emergencyQuarantineAiApiAdmission(reserved.id, "BILLING_STATE_UNCONFIRMED");
      throw new AiApiError("billing_state_unconfirmed", "Status billing belum dapat disimpan dengan aman.", 503, { requestId: reserved.id, requestStatus: "RESERVED" });
    }
    throw error;
  }
  const provider = input.provider ?? (reserved.provider === "GRIPHUB"
    ? new GriphubChatProvider()
    : (() => { throw new AiApiError("provider_unavailable", "Provider model tidak didukung.", 503, { requestId: reserved.id, requestStatus: "DISPATCHING" }); })());
  let result: Awaited<ReturnType<Provider["complete"]>>;
  try {
    result = await provider.complete({
      requestId: reserved.id,
      idempotencyKey: reserved.upstreamIdempotencyKey,
      model: reserved.upstreamModelId,
      messages: input.request.messages,
      // Always transmit the same effective ceiling used by the reservation,
      // including the local default when the client omits an optional cap.
      maxCompletionTokens: input.request.maxCompletionTokens,
      temperature: input.request.temperature,
      tools: input.request.tools,
      toolChoice: input.request.toolChoice,
      parallelToolCalls: input.request.parallelToolCalls,
    });
  } catch (error) {
    if (error instanceof SekaiChatProviderError && error.definitelyUnbilled) {
      try {
        await releaseAiApiRequest(reserved.id, error.category, new Date(), { openBreaker: error.openBreaker });
      } catch {
        await emergencyQuarantineAiApiAdmission(reserved.id, "BILLING_STATE_UNCONFIRMED");
        throw new AiApiError("billing_state_unconfirmed", "Status billing belum dapat disimpan dengan aman.", 503, { requestId: reserved.id, requestStatus: "DISPATCHING" });
      }
    } else {
      await persistReconciliationOrThrow(reserved.id, error instanceof SekaiChatProviderError ? error.category : "UNKNOWN_PROVIDER_OUTCOME", error instanceof SekaiChatProviderError ? error.openBreaker : true, error instanceof SekaiChatProviderError ? error.providerRequestId : undefined);
    }
    if (error instanceof SekaiChatProviderError) throw new AiApiError(error.category.toLowerCase(), error.message, error.definitelyUnbilled ? 502 : 502, { requestId: reserved.id, requestStatus: error.definitelyUnbilled ? "FAILED_RELEASED" : "RECONCILIATION_REQUIRED" });
    throw new AiApiError("provider_outcome_unknown", "Status request provider belum dapat dipastikan.", 502, { requestId: reserved.id, requestStatus: "RECONCILIATION_REQUIRED" });
  }
  let response: TResponse;
  try {
    response = input.responseAdapter
      ? input.responseAdapter({ requestId: reserved.id, chatResponse: result.response })
      : result.response as TResponse;
  } catch {
    await persistReconciliationOrThrow(reserved.id, "INVALID_RESPONSE", true, result.providerRequestId, { promptTokens: result.promptTokens, completionTokens: result.completionTokens });
    throw new AiApiError("invalid_response", "Respons provider tidak valid dan memerlukan rekonsiliasi.", 502, { requestId: reserved.id, requestStatus: "RECONCILIATION_REQUIRED" });
  }
  let replay: ReturnType<typeof encryptAiApiResponseReplay> | undefined;
  if (input.replayCompletedResponse) {
    try {
      replay = encryptAiApiResponseReplay(response, {
        requestId: reserved.id,
        apiKeyId: auth.id,
        walletId: auth.walletId,
        endpoint: input.endpoint ?? "chat.completions",
        requestFingerprint: fingerprint,
      });
    } catch {
      await persistReconciliationOrThrow(reserved.id, "REPLAY_PERSISTENCE_FAILED", false, result.providerRequestId, { promptTokens: result.promptTokens, completionTokens: result.completionTokens });
      throw new AiApiError("replay_persistence_failed", "Respons tidak dapat disimpan dengan aman dan memerlukan rekonsiliasi.", 502, { requestId: reserved.id, requestStatus: "RECONCILIATION_REQUIRED" });
    }
  }
  try {
    const settlement = await finalizeAiApiRequest({
      requestId: reserved.id,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      providerRequestId: result.providerRequestId,
      responseReplayCiphertext: replay?.ciphertext,
      responseReplayExpiresAt: replay?.expiresAt,
    });
    return { requestId: reserved.id, chargeMicros: settlement.chargeMicros, response, replayed: false as const };
  } catch (error) {
    if (error instanceof AiApiError && error.requestStatus === "MANUAL_REVIEW") throw error;
    await persistReconciliationOrThrow(reserved.id, error instanceof AiApiError ? error.code : "FINALIZATION_FAILED", true, result.providerRequestId, {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      responseReplayCiphertext: replay?.ciphertext,
      responseReplayExpiresAt: replay?.expiresAt,
    });
    throw new AiApiError("finalization_failed", "Penyelesaian billing memerlukan rekonsiliasi.", 503, { requestId: reserved.id, requestStatus: "RECONCILIATION_REQUIRED" });
  }
}
