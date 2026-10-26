import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendGoogleSignInHelpEmail, sendPasswordResetEmail } from "@/lib/email/service";
import { generatePasswordResetToken, hashPasswordResetToken, hashResetRateKey, PASSWORD_RESET_MAX_PER_EMAIL, PASSWORD_RESET_MAX_PER_IP, PASSWORD_RESET_REQUEST_WINDOW_MS, PASSWORD_RESET_TTL_MS } from "@/lib/password-reset";
import { clientRateLimitIdentity } from "@/lib/trusted-client-ip";

const GENERIC_RESPONSE = "Jika email tersebut terdaftar, kami akan mengirimkan instruksi berikutnya. Periksa inbox dan folder spam.";

function normalizedEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function requestIp(request: Request) {
  return clientRateLimitIdentity(request);
}

async function reserveRequest(emailHash: string, ipHash: string, now: Date) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const since = new Date(now.getTime() - PASSWORD_RESET_REQUEST_WINDOW_MS);
        const [byEmail, byIp] = await Promise.all([
          tx.passwordResetRequest.count({ where: { emailHash, createdAt: { gte: since } } }),
          tx.passwordResetRequest.count({ where: { ipHash, createdAt: { gte: since } } }),
        ]);
        if (byEmail >= PASSWORD_RESET_MAX_PER_EMAIL || byIp >= PASSWORD_RESET_MAX_PER_IP) return false;
        await tx.passwordResetRequest.create({ data: { emailHash, ipHash, createdAt: now } });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034") return false;
    }
  }
  return false;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizedEmail(body.email);
  const now = new Date();
  if (!email || email.length > 320 || !email.includes("@")) return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });

  try {
    const reserved = await reserveRequest(hashResetRateKey(`email:${email}`), hashResetRateKey(`ip:${requestIp(request)}`), now);
    if (!reserved) return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, passwordHash: true, isActive: true } });
    if (!user || !user.isActive) return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });

    if (!user.passwordHash) {
      await sendGoogleSignInHelpEmail({ to: user.email, name: user.name }).catch(() => undefined);
      return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });
    }

    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const tokenRecord = await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      return tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS) }, select: { id: true } });
    });
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, token });
    } catch {
      await prisma.passwordResetToken.deleteMany({ where: { id: tokenRecord.id, tokenHash } }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });
  } catch {
    return NextResponse.json({ ok: true, message: GENERIC_RESPONSE });
  }
}
