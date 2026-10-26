import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createApiKey } from "./api-keys";

const ZERO = BigInt(0);
const MAX_ACTIVE_CUSTOMER_KEYS = 5;
const CUSTOMER_RATE_LIMIT = 60;
const CUSTOMER_CONCURRENCY_LIMIT = 2;
const CUSTOMER_DAILY_LIMIT_MICROS = BigInt(100_000) * BigInt(1_000_000);
const MAX_CUSTOMER_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function retryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
}
async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (!retryable(error) || attempt === 2) throw error; }
  }
  throw new Error("Konflik penyimpanan AI API.");
}

function validIssuanceEventKey(value: string) {
  return /^customer-key:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9._:+/-]{8,200}$/.test(value);
}

export class AiApiAccountError extends Error {
  constructor(readonly code: "duplicate_issuance" | "key_limit_reached" | "invalid_expiry" | "key_not_found", message: string) { super(message); this.name = "AiApiAccountError"; }
}

export async function createCustomerAiApiKey(input: { userId: string; name: string; issuanceEventKey: string; expiresAt?: Date }) {
  if (!input.name.trim() || input.name.trim().length > 100) throw new Error("Nama API key tidak valid.");
  if (!validIssuanceEventKey(input.issuanceEventKey)) throw new Error("Idempotency-Key tidak valid.");
  const now = new Date();
  if (input.expiresAt && (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_CUSTOMER_KEY_LIFETIME_MS)) throw new AiApiAccountError("invalid_expiry", "Masa berlaku API key tidak valid.");
  const generated = createApiKey();
  return serializable(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true, role: true } });
    if (!user?.isActive || user.role !== "CUSTOMER") throw new Error("Akun tidak aktif atau tidak berhak.");
    const duplicate = await tx.aiApiKey.findUnique({ where: { issuanceEventKey: input.issuanceEventKey }, select: { id: true, wallet: { select: { userId: true } } } });
    if (duplicate) {
      if (duplicate.wallet.userId !== input.userId) throw new Error("Konflik penerbitan API key.");
      throw new AiApiAccountError("duplicate_issuance", "Permintaan ini sudah diproses. API key tidak dapat ditampilkan kembali.");
    }
    const wallet = await tx.aiApiWallet.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
    const activeKeyCount = await tx.aiApiKey.count({ where: { walletId: wallet.id, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    if (activeKeyCount >= MAX_ACTIVE_CUSTOMER_KEYS) throw new AiApiAccountError("key_limit_reached", "Batas lima API key aktif telah tercapai.");
    const key = await tx.aiApiKey.create({ data: { walletId: wallet.id, name: input.name.trim(), prefix: generated.prefix, secretHash: generated.secretHash, issuanceEventKey: input.issuanceEventKey, rateLimitPerMinute: CUSTOMER_RATE_LIMIT, concurrencyLimit: CUSTOMER_CONCURRENCY_LIMIT, dailySpendLimitMicros: CUSTOMER_DAILY_LIMIT_MICROS, expiresAt: input.expiresAt } });
    await tx.auditLog.create({ data: { actorId: input.userId, action: "AI_API_KEY_CREATED", entityType: "AiApiKey", entityId: key.id, metadata: { userId: input.userId, prefix: key.prefix, customerIssued: true, rateLimitPerMinute: key.rateLimitPerMinute, concurrencyLimit: key.concurrencyLimit, dailySpendLimitMicros: key.dailySpendLimitMicros.toString(), expiresAt: key.expiresAt?.toISOString() ?? null } } });
    return { id: key.id, name: key.name, prefix: key.prefix, plaintext: generated.plaintext, createdAt: key.createdAt, expiresAt: key.expiresAt };
  });
}

export async function revokeCustomerAiApiKey(input: { userId: string; keyId: string; reason: string }) {
  if (!input.keyId.trim() || input.reason.trim().length < 3 || input.reason.trim().length > 300) throw new Error("Input pencabutan tidak valid.");
  return serializable(async (tx) => {
    const key = await tx.aiApiKey.findFirst({ where: { id: input.keyId, wallet: { userId: input.userId } }, select: { id: true, status: true, prefix: true } });
    if (!key) throw new AiApiAccountError("key_not_found", "API key tidak ditemukan.");
    if (key.status === "REVOKED") return { duplicate: true as const, id: key.id };
    await tx.aiApiKey.update({ where: { id: key.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.userId, action: "AI_API_KEY_REVOKED", entityType: "AiApiKey", entityId: key.id, metadata: { prefix: key.prefix, reason: input.reason.trim(), customerIssued: true } } });
    return { duplicate: false as const, id: key.id };
  });
}

export async function customerAiApiOverview(userId: string) {
  const wallet = await prisma.aiApiWallet.findUnique({
    where: { userId },
    select: {
      availableMicros: true, reservedMicros: true, dailySpendLimitMicros: true, isFrozen: true, frozenReason: true,
      keys: { select: { id: true, name: true, prefix: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true, rateLimitPerMinute: true, concurrencyLimit: true, dailySpendLimitMicros: true }, orderBy: { createdAt: "desc" } },
      ledgerEntries: { select: { id: true, kind: true, availableDeltaMicros: true, reservedDeltaMicros: true, availableAfterMicros: true, reservedAfterMicros: true, safeReasonCode: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 12 },
      dailyUsage: { select: { spentMicros: true, reservedMicros: true, admittedRequestCount: true, usageDate: true }, orderBy: { usageDate: "desc" }, take: 30 },
    },
  });
  if (!wallet) return { wallet: null, keys: [], ledger: [], daily: { spentMicros: ZERO, reservedMicros: ZERO, admittedRequestCount: BigInt(0) }, dailyHistory: [] };
  return { wallet, keys: wallet.keys, ledger: wallet.ledgerEntries, daily: wallet.dailyUsage[0] ?? { spentMicros: ZERO, reservedMicros: ZERO, admittedRequestCount: BigInt(0) }, dailyHistory: wallet.dailyUsage };
}

export function customerAiApiOverviewResponse(data: Awaited<ReturnType<typeof customerAiApiOverview>>) {
  const wallet = data.wallet ? {
    availableMicros: data.wallet.availableMicros.toString(), reservedMicros: data.wallet.reservedMicros.toString(), dailySpendLimitMicros: data.wallet.dailySpendLimitMicros.toString(), isFrozen: data.wallet.isFrozen, frozenReason: data.wallet.frozenReason,
  } : null;
  return {
    wallet,
    keys: data.keys.map((key) => ({ ...key, dailySpendLimitMicros: key.dailySpendLimitMicros.toString() })),
    ledger: data.ledger.map((entry) => ({ ...entry, availableDeltaMicros: entry.availableDeltaMicros.toString(), reservedDeltaMicros: entry.reservedDeltaMicros.toString(), availableAfterMicros: entry.availableAfterMicros.toString(), reservedAfterMicros: entry.reservedAfterMicros.toString() })),
    daily: { spentMicros: data.daily.spentMicros.toString(), reservedMicros: data.daily.reservedMicros.toString(), admittedRequestCount: data.daily.admittedRequestCount.toString() },
    dailyHistory: data.dailyHistory.map((row) => ({ usageDate: row.usageDate, spentMicros: row.spentMicros.toString(), reservedMicros: row.reservedMicros.toString(), admittedRequestCount: row.admittedRequestCount.toString() })),
  };
}

export const customerAiApiPolicy = { maxActiveKeys: MAX_ACTIVE_CUSTOMER_KEYS, rateLimitPerMinute: CUSTOMER_RATE_LIMIT, concurrencyLimit: CUSTOMER_CONCURRENCY_LIMIT, dailySpendLimitMicros: CUSTOMER_DAILY_LIMIT_MICROS };
