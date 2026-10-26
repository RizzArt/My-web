import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmailVerificationCode } from "@/lib/email/service";
import { EMAIL_VERIFICATION_MAX_ATTEMPTS, EMAIL_VERIFICATION_MAX_RESENDS_PER_HOUR, EMAIL_VERIFICATION_RESEND_COOLDOWN_MS, EMAIL_VERIFICATION_TTL_MS, generateVerificationCode, hashVerificationCode, isExpired, verificationCodeMatches } from "@/lib/email-verification";

const emailInput = (value: unknown) => String(value ?? "").trim().toLowerCase();
const genericError = "Kode tidak valid atau sudah kedaluwarsa.";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; code?: unknown };
    const email = emailInput(body.email);
    const code = String(body.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) return NextResponse.json({ error: genericError }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
    if (!user || user.emailVerified) return NextResponse.json({ error: genericError }, { status: 400 });
    const record = await prisma.emailVerificationCode.findUnique({ where: { userId: user.id } });
    if (!record) return NextResponse.json({ error: genericError }, { status: 400 });
    if (isExpired(record.expiresAt) || record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await prisma.emailVerificationCode.deleteMany({ where: { id: record.id } });
      return NextResponse.json({ error: genericError }, { status: 400 });
    }
    if (!verificationCodeMatches(code, record.codeHash)) {
      const nextAttempts = record.attempts + 1;
      if (nextAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) await prisma.emailVerificationCode.deleteMany({ where: { id: record.id } });
      else await prisma.emailVerificationCode.update({ where: { id: record.id }, data: { attempts: nextAttempts } });
      return NextResponse.json({ error: genericError }, { status: 400 });
    }
    const deleted = await prisma.emailVerificationCode.deleteMany({ where: { id: record.id, codeHash: record.codeHash } });
    if (deleted.count !== 1) return NextResponse.json({ error: genericError }, { status: 400 });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan. Silakan coba lagi." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { email?: unknown };
    const email = emailInput(body.email);
    if (!email) return NextResponse.json({ ok: true });
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerified: true } });
    if (!user || user.emailVerified) return NextResponse.json({ ok: true });
    const current = new Date();
    const existing = await prisma.emailVerificationCode.findUnique({ where: { userId: user.id } });
    if (existing && current.getTime() - existing.lastSentAt.getTime() < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) return NextResponse.json({ error: "Tunggu 60 detik sebelum mengirim ulang kode." }, { status: 429 });
    const windowActive = existing && current.getTime() - existing.resendWindowStartedAt.getTime() < 60 * 60 * 1000;
    if (existing && windowActive && existing.resendCount >= EMAIL_VERIFICATION_MAX_RESENDS_PER_HOUR) return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429 });
    const code = generateVerificationCode();
    await prisma.emailVerificationCode.upsert({
      where: { userId: user.id },
      update: { codeHash: hashVerificationCode(code), expiresAt: new Date(current.getTime() + EMAIL_VERIFICATION_TTL_MS), attempts: 0, lastSentAt: current, resendCount: windowActive ? { increment: 1 } : 1, resendWindowStartedAt: windowActive ? undefined : current },
      create: { userId: user.id, codeHash: hashVerificationCode(code), expiresAt: new Date(current.getTime() + EMAIL_VERIFICATION_TTL_MS), lastSentAt: current },
    });
    await sendEmailVerificationCode({ to: user.email, code });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan. Silakan coba lagi." }, { status: 500 });
  }
}
