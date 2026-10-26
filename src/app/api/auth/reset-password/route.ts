import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { passwordResetSchema } from "@/lib/auth-validation";
import { hashPasswordResetToken, PASSWORD_RESET_MAX_ATTEMPTS, passwordResetExpired, passwordResetTokenMatches } from "@/lib/password-reset";

const INVALID_RESPONSE = "Tautan reset password tidak valid, sudah kedaluwarsa, atau sudah digunakan.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = passwordResetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? INVALID_RESPONSE }, { status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

  try {
    const tokenHash = hashPasswordResetToken(parsed.data.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, tokenHash: true, expiresAt: true, usedAt: true, attempts: true, user: { select: { isActive: true } } } });
    const invalid = !record || !record.user.isActive || record.usedAt || passwordResetExpired(record.expiresAt) || record.attempts >= PASSWORD_RESET_MAX_ATTEMPTS || !passwordResetTokenMatches(parsed.data.token, record.tokenHash);
    if (invalid) {
      if (record && !record.usedAt && !passwordResetExpired(record.expiresAt)) await prisma.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, attempts: { lt: PASSWORD_RESET_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } }).catch(() => undefined);
      return NextResponse.json({ error: INVALID_RESPONSE }, { status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    const now = new Date();
    const consumed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, tokenHash, usedAt: null, expiresAt: { gt: now }, attempts: { lt: PASSWORD_RESET_MAX_ATTEMPTS } }, data: { usedAt: now, attempts: { increment: 1 } } });
      if (claimed.count !== 1) return false;
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      return true;
    });
    if (!consumed) return NextResponse.json({ error: INVALID_RESPONSE }, { status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan. Silakan coba lagi." }, { status: 500, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
