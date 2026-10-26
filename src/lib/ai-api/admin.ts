import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createApiKey } from "./api-keys";
import { catalogModel } from "./catalog";
import { acquireAiApiProviderAdmissionLock } from "./provider-health";
import { finalizeAiApiRequest, releaseAiApiRequest } from "./service";

const ZERO = BigInt(0);
const ONE = BigInt(1);

function retryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
}
async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 }); }
    catch (error) { if (!retryable(error) || attempt === 2) throw error; }
  }
  throw new Error("Konflik penyimpanan AI API.");
}

export async function createAiApiKeyForUser(input: { actorId: string; userId: string; name: string; rateLimitPerMinute: number; concurrencyLimit: number; dailySpendLimitMicros: bigint; expiresAt?: Date; issuanceEventKey?: string }) {
  if (!input.name.trim() || input.name.trim().length > 100) throw new Error("Nama API key tidak valid.");
  if (!Number.isInteger(input.rateLimitPerMinute) || input.rateLimitPerMinute < 1 || input.rateLimitPerMinute > 10_000) throw new Error("Rate limit tidak valid.");
  if (!Number.isInteger(input.concurrencyLimit) || input.concurrencyLimit < 1 || input.concurrencyLimit > 100) throw new Error("Concurrency limit tidak valid.");
  if (input.dailySpendLimitMicros <= ZERO) throw new Error("Batas harian tidak valid.");
  if (input.issuanceEventKey && !/^admin-key:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9._:+/-]{8,200}$/.test(input.issuanceEventKey)) throw new Error("Event penerbitan API key tidak valid.");
  const generated = createApiKey();
  const record = await serializable(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== "ADMIN") throw new Error("Admin tidak valid.");
    if (input.issuanceEventKey) {
      const existing = await tx.aiApiKey.findUnique({ where: { issuanceEventKey: input.issuanceEventKey }, include: { wallet: { select: { userId: true } } } });
      if (existing) {
        if (existing.wallet.userId !== input.userId) throw new Error("Event penerbitan API key tidak konsisten.");
        throw new Error("Penerbitan ini sudah diproses. API key tidak dapat ditampilkan kembali.");
      }
    }
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true } });
    if (!user?.isActive) throw new Error("Pengguna tidak aktif atau tidak ditemukan.");
    const wallet = await tx.aiApiWallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const key = await tx.aiApiKey.create({ data: { walletId: wallet.id, name: input.name.trim(), prefix: generated.prefix, secretHash: generated.secretHash, issuanceEventKey: input.issuanceEventKey, rateLimitPerMinute: input.rateLimitPerMinute, concurrencyLimit: input.concurrencyLimit, dailySpendLimitMicros: input.dailySpendLimitMicros, expiresAt: input.expiresAt } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "AI_API_KEY_CREATED", entityType: "AiApiKey", entityId: key.id, metadata: { userId: user.id, prefix: key.prefix, rateLimitPerMinute: key.rateLimitPerMinute, concurrencyLimit: key.concurrencyLimit, dailySpendLimitMicros: key.dailySpendLimitMicros.toString(), expiresAt: key.expiresAt?.toISOString() ?? null } } });
    return key;
  });
  return { id: record.id, name: record.name, prefix: record.prefix, plaintext: generated.plaintext, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

export async function fundAiApiWallet(input: { actorId: string; userId: string; amountMicros: bigint; eventKey: string; reason: string }) {
  if (input.amountMicros <= ZERO) throw new Error("Jumlah dana harus positif.");
  if (!/^[A-Za-z0-9._:+/-]{8,260}$/.test(input.eventKey)) throw new Error("Event key tidak valid.");
  if (input.reason.trim().length < 3 || input.reason.trim().length > 300) throw new Error("Alasan pendanaan tidak valid.");
  return serializable(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== "ADMIN") throw new Error("Admin tidak valid.");
    await acquireAiApiProviderAdmissionLock(tx);
    const existing = await tx.aiApiLedgerEntry.findUnique({ where: { eventKey: input.eventKey }, include: { wallet: true } });
    if (existing) {
      if (existing.kind !== "FUND" || existing.wallet.userId !== input.userId || existing.availableDeltaMicros !== input.amountMicros || existing.reservedDeltaMicros !== ZERO) throw new Error("Event pendanaan tidak konsisten.");
      return { duplicate: true as const, walletId: existing.walletId, availableMicros: existing.availableAfterMicros };
    }
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true } });
    if (!user?.isActive) throw new Error("Pengguna tidak aktif atau tidak ditemukan.");
    const wallet = await tx.aiApiWallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const availableAfter = wallet.availableMicros + input.amountMicros;
    const sequence = wallet.ledgerSequence + ONE;
    await tx.aiApiWallet.update({ where: { id: wallet.id }, data: { availableMicros: availableAfter, ledgerSequence: sequence } });
    await tx.aiApiLedgerEntry.create({ data: { walletId: wallet.id, sequence, kind: "FUND", eventKey: input.eventKey, availableDeltaMicros: input.amountMicros, reservedDeltaMicros: ZERO, availableAfterMicros: availableAfter, reservedAfterMicros: wallet.reservedMicros, safeReasonCode: "ADMIN_PRIVATE_BETA_FUND", actorId: input.actorId } });
    await tx.aiApiProviderHealth.updateMany({ where: { breakerState: "CLOSED", model: { enabled: true } }, data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: 0, safeReasonCode: "AUTO_HEALTH_LIABILITY_CHANGED" } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "AI_API_WALLET_FUNDED", entityType: "AiApiWallet", entityId: wallet.id, metadata: { userId: user.id, amountMicros: input.amountMicros.toString(), eventKey: input.eventKey, reason: input.reason.trim() } } });
    return { duplicate: false as const, walletId: wallet.id, availableMicros: availableAfter };
  });
}

export async function revokeAiApiKey(input: { actorId: string; keyId: string; reason: string }) {
  if (input.reason.trim().length < 3 || input.reason.trim().length > 300) throw new Error("Alasan pencabutan tidak valid.");
  return serializable(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== "ADMIN") throw new Error("Admin tidak valid.");
    const key = await tx.aiApiKey.findUnique({ where: { id: input.keyId }, select: { id: true, status: true, prefix: true } });
    if (!key) throw new Error("API key tidak ditemukan.");
    if (key.status === "REVOKED") return { duplicate: true as const, id: key.id };
    await tx.aiApiKey.update({ where: { id: key.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "AI_API_KEY_REVOKED", entityType: "AiApiKey", entityId: key.id, metadata: { prefix: key.prefix, reason: input.reason.trim() } } });
    return { duplicate: false as const, id: key.id };
  });
}

export async function setAiApiModelAvailability(input: { actorId: string; publicId: string; enabled: boolean; expectedPriceVersion: number; verificationReference: string; reason: string }) {
  if (!input.publicId.trim()) throw new Error("Model tidak valid.");
  const expectedCatalogModel = catalogModel(input.publicId);
  if (!expectedCatalogModel) throw new Error("Model tidak valid.");
  // No admin/credential override can grant admission to a retired provider or
  // to the retained provider before a separately reviewed financial contract.
  if (input.enabled) throw new Error(expectedCatalogModel.provider === "SEKAI"
    ? "Layanan API model ini telah dihentikan."
    : "Model belum dapat diaktifkan sebelum kontrak billing provider terverifikasi.");
  if (!Number.isInteger(input.expectedPriceVersion) || input.expectedPriceVersion < 1) throw new Error("Versi harga tidak valid.");
  if (!/^[A-Za-z0-9._:+/-]{6,200}$/.test(input.verificationReference)) throw new Error("Referensi verifikasi tidak valid.");
  if (input.reason.trim().length < 3 || input.reason.trim().length > 300) throw new Error("Alasan perubahan tidak valid.");
  return serializable(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== "ADMIN") throw new Error("Admin tidak valid.");
    await acquireAiApiProviderAdmissionLock(tx);
    const model = await tx.aiApiModel.findUnique({ where: { publicId: input.publicId }, include: { providerHealth: true } });
    if (!model || !model.providerHealth) throw new Error("Model tidak ditemukan.");
    if (model.provider !== expectedCatalogModel.provider
      || model.upstreamModelId !== expectedCatalogModel.upstreamModelId
      || model.maxInputTokens !== expectedCatalogModel.providerMaxInputTokens
      || model.maxOutputTokens !== expectedCatalogModel.providerMaxOutputTokens
      || model.privateBetaMaxOutputTokens !== expectedCatalogModel.privateBetaMaxOutputTokens
      || model.maxRequestBytes !== expectedCatalogModel.maxRequestBytes) throw new Error("Mapping model provider tidak valid.");
    // Protective disable never needs a verified price or an upstream request.
    await tx.aiApiModel.update({ where: { id: model.id }, data: { enabled: false } });
    await tx.aiApiProviderHealth.update({ where: { modelId: model.id }, data: { breakerState: "OPEN", healthyUntil: null, safeReasonCode: `OPERATOR_DISABLED:${input.verificationReference}` } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "AI_API_MODEL_AVAILABILITY_CHANGED", entityType: "AiApiModel", entityId: model.id, metadata: { publicId: model.publicId, enabled: false, expectedPriceVersion: input.expectedPriceVersion, verificationReference: input.verificationReference, reason: input.reason.trim(), healthyForSeconds: null, paygBalanceRupiah: null, requiredPaygBalanceRupiah: null } } });
    return { id: model.publicId, enabled: false, breakerState: "OPEN" as const };
  });
}

export async function settleAiApiRequestByAdmin(input: { actorId: string; requestId: string; action: "RELEASE_UNBILLED" | "FINALIZE_USAGE"; reason: string; providerRequestId?: string; unbilledEvidenceReference?: string }) {
  if (!input.requestId.trim()) throw new Error("Request tidak valid.");
  if (input.reason.trim().length < 3 || input.reason.trim().length > 300) throw new Error("Alasan rekonsiliasi tidak valid.");
  const actor = await prisma.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive || actor.role !== "ADMIN") throw new Error("Admin tidak valid.");
  if (input.action === "RELEASE_UNBILLED") {
    if (!/^[A-Za-z0-9._:/-]{8,300}$/.test(input.unbilledEvidenceReference ?? "")) throw new Error("Referensi bukti tidak tertagih tidak valid.");
    const result = await releaseAiApiRequest(input.requestId, "ADMIN_CONFIRMED_UNBILLED", new Date(), { recoveryOnly: true, openBreaker: false, actorId: input.actorId, auditReason: input.reason.trim(), unbilledEvidenceReference: input.unbilledEvidenceReference });
    return { action: input.action, duplicate: result.duplicate };
  }
  const result = await finalizeAiApiRequest({ requestId: input.requestId, providerRequestId: input.providerRequestId, recoveryOnly: true, actorId: input.actorId, auditReason: input.reason.trim() });
  return { action: input.action, duplicate: result.duplicate, chargeMicros: result.chargeMicros };
}
