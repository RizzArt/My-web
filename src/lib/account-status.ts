import type { Prisma } from "@prisma/client";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

export async function refreshActiveToken(token: JWT): Promise<JWT | null> {
  if (!token.id) return null;
  const current = await prisma.user.findUnique({
    where: { id: token.id },
    select: { role: true, isActive: true, sessionVersion: true },
  });
  if (!current?.isActive) return null;
  if (token.sessionVersion !== undefined && token.sessionVersion !== current.sessionVersion) return null;
  return { ...token, role: current.role, sessionVersion: current.sessionVersion, active: true };
}

export class AccountStatusError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function changeAccountStatus(
  tx: Prisma.TransactionClient,
  actorId: string,
  userId: string,
  isActive: boolean,
  reason: string
) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true },
  });
  if (!actor?.isActive || actor.role !== "ADMIN") {
    throw new AccountStatusError("Akses admin diperlukan.", 403);
  }
  const target = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) throw new AccountStatusError("Akun tidak ditemukan.", 404);
  if (target.id === actorId || !["CUSTOMER", "SELLER"].includes(target.role)) {
    throw new AccountStatusError("Menu ini hanya untuk akun buyer dan seller.", 403);
  }
  if (!isActive && reason.trim().length < 3) {
    throw new AccountStatusError("Alasan ban minimal 3 karakter.", 400);
  }
  if (target.isActive === isActive) return { changed: false, isActive };
  const updated = await tx.user.updateMany({
    where: { id: userId, role: target.role, isActive: target.isActive },
    data: { isActive },
  });
  if (updated.count !== 1) {
    throw new AccountStatusError("Status akun berubah. Muat ulang halaman.", 409);
  }
  await tx.auditLog.create({
    data: {
      actorId,
      action: isActive ? "ACCOUNT_UNBANNED" : "ACCOUNT_BANNED",
      entityType: "User",
      entityId: userId,
      metadata: {
        role: target.role,
        previousIsActive: target.isActive,
        isActive,
        reason: reason.trim(),
      },
    },
  });
  return { changed: true, isActive };
}
