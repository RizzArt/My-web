import bcrypt from "bcryptjs";
import { Role, Prisma } from "@prisma/client";
import { adminPasswordSchema } from "@/lib/auth-validation";

export const BCRYPT_ROUNDS = 12;
type LoginAttempt = { count: number; resetAt: number };
const attempts = new Map<string, LoginAttempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function isLoginRateLimited(identifier: string, now = Date.now()) {
  const current = attempts.get(identifier);
  return Boolean(current && current.resetAt > now && current.count >= MAX_ATTEMPTS);
}

export function recordLoginFailure(identifier: string, now = Date.now()) {
  const current = attempts.get(identifier);
  if (!current || current.resetAt <= now) attempts.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
  else current.count += 1;
}

export function clearLoginFailures(identifier: string) { attempts.delete(identifier); }

export function validateAdminPassword(password: string) { return adminPasswordSchema.safeParse(password); }

export async function hashAdminPassword(password: string) {
  const parsed = validateAdminPassword(password);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Password admin tidak valid.");
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function assertNotLastActiveAdmin(tx: Pick<Prisma.TransactionClient, "user">, userId: string) {
  const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!target || target.role !== Role.ADMIN || !target.isActive) return;
  const activeAdmins = await tx.user.count({ where: { role: Role.ADMIN, isActive: true } });
  if (activeAdmins <= 1) throw new Error("Minimal harus ada satu admin aktif.");
}
