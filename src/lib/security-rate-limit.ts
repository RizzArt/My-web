import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Limit = { scope: string; identifier: string; limit: number; windowMs: number };
export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_MAX_PER_ACCOUNT = 10;
export const LOGIN_FAILURE_MAX_PER_IP = 50;
export const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
export const REGISTRATION_MAX_PER_EMAIL = 5;
export const REGISTRATION_MAX_PER_IP = 20;

function rateLimitSecret() {
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("RATE_LIMIT_SECRET atau AUTH_SECRET wajib dikonfigurasi di production.");
  return "development-rate-limit-secret";
}

export function hashRateLimitKey(value: string) {
  return createHmac("sha256", rateLimitSecret()).update(value).digest("hex");
}

function windowStart(now: Date, windowMs: number) {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

function retryAfterSeconds(now: Date, start: Date, windowMs: number) {
  return Math.max(1, Math.ceil((start.getTime() + windowMs - now.getTime()) / 1000));
}

export async function isRateLimited(limit: Limit, now = new Date()): Promise<LimitResult> {
  const start = windowStart(now, limit.windowMs);
  const record = await prisma.securityRateLimit.findUnique({
    where: { scope_keyHash_windowStart: { scope: limit.scope, keyHash: hashRateLimitKey(limit.identifier), windowStart: start } },
    select: { count: true },
  });
  return { allowed: !record || record.count < limit.limit, retryAfterSeconds: retryAfterSeconds(now, start, limit.windowMs) };
}

export async function consumeRateLimit(limit: Limit, now = new Date()): Promise<LimitResult> {
  const start = windowStart(now, limit.windowMs);
  const keyHash = hashRateLimitKey(limit.identifier);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.securityRateLimit.findUnique({ where: { scope_keyHash_windowStart: { scope: limit.scope, keyHash, windowStart: start } }, select: { id: true, count: true } });
        if (current?.count !== undefined && current.count >= limit.limit) return { allowed: false, retryAfterSeconds: retryAfterSeconds(now, start, limit.windowMs) };
        if (current) await tx.securityRateLimit.update({ where: { id: current.id }, data: { count: { increment: 1 } } });
        else await tx.securityRateLimit.create({ data: { scope: limit.scope, keyHash, windowStart: start, count: 1 } });
        return { allowed: true, retryAfterSeconds: retryAfterSeconds(now, start, limit.windowMs) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  // A storage race must not turn into unlimited authentication attempts.
  return { allowed: false, retryAfterSeconds: Math.ceil(limit.windowMs / 1000) };
}

export async function clearRateLimit(limit: Omit<Limit, "limit">, now = new Date()) {
  const start = windowStart(now, limit.windowMs);
  await prisma.securityRateLimit.deleteMany({ where: { scope: limit.scope, keyHash: hashRateLimitKey(limit.identifier), windowStart: start } });
}
