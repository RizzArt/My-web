import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registrationSchema } from "@/lib/auth-validation";
import { sendEmailVerificationCode } from "@/lib/email/service";
import { EMAIL_VERIFICATION_MAX_RESENDS_PER_HOUR, EMAIL_VERIFICATION_RESEND_COOLDOWN_MS, EMAIL_VERIFICATION_TTL_MS, generateVerificationCode, hashVerificationCode } from "@/lib/email-verification";
import { consumeRateLimit, REGISTRATION_MAX_PER_EMAIL, REGISTRATION_MAX_PER_IP, REGISTRATION_WINDOW_MS } from "@/lib/security-rate-limit";
import { clientRateLimitIdentity } from "@/lib/trusted-client-ip";

export async function POST(request: Request) {
  try {
    const parsed = registrationSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data pendaftaran tidak valid." }, { status: 400 });
    const [emailRate, ipRate] = await Promise.all([
      consumeRateLimit({ scope: "registration-email", identifier: parsed.data.email, limit: REGISTRATION_MAX_PER_EMAIL, windowMs: REGISTRATION_WINDOW_MS }),
      consumeRateLimit({ scope: "registration-ip", identifier: clientRateLimitIdentity(request), limit: REGISTRATION_MAX_PER_IP, windowMs: REGISTRATION_WINDOW_MS }),
    ]);
    if (!emailRate.allowed || !ipRate.allowed) {
      const retryAfter = Math.max(emailRate.retryAfterSeconds, ipRate.retryAfterSeconds);
      return NextResponse.json({ error: "Terlalu banyak pendaftaran. Coba lagi nanti." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, emailVerified: true } });
    if (existing?.emailVerified) return NextResponse.json({ error: "Email sudah digunakan." }, { status: 400 });
    if (existing) {
      const current = new Date();
      const verification = await prisma.emailVerificationCode.findUnique({ where: { userId: existing.id } });
      if (verification && current.getTime() - verification.lastSentAt.getTime() < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) return NextResponse.json({ error: "Tunggu 60 detik sebelum mengirim ulang kode." }, { status: 429 });
      const windowActive = verification && current.getTime() - verification.resendWindowStartedAt.getTime() < 60 * 60 * 1000;
      if (verification && windowActive && verification.resendCount >= EMAIL_VERIFICATION_MAX_RESENDS_PER_HOUR) return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429 });
      const code = generateVerificationCode();
      await prisma.emailVerificationCode.upsert({
        where: { userId: existing.id },
        update: { codeHash: hashVerificationCode(code), expiresAt: new Date(current.getTime() + EMAIL_VERIFICATION_TTL_MS), attempts: 0, lastSentAt: current, resendCount: windowActive ? { increment: 1 } : 1, resendWindowStartedAt: windowActive ? undefined : current },
        create: { userId: existing.id, codeHash: hashVerificationCode(code), expiresAt: new Date(current.getTime() + EMAIL_VERIFICATION_TTL_MS), lastSentAt: current },
      });
      await sendEmailVerificationCode({ to: parsed.data.email, code });
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
    const user = await prisma.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash, emailVerified: null } });
    await prisma.emailVerificationCode.upsert({
      where: { userId: user.id },
      update: { codeHash: hashVerificationCode(code), expiresAt, attempts: 0, lastSentAt: new Date(), resendCount: 0, resendWindowStartedAt: new Date() },
      create: { userId: user.id, codeHash: hashVerificationCode(code), expiresAt },
    });
    await sendEmailVerificationCode({ to: user.email, code });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan. Silakan coba lagi." }, { status: 500 });
  }
}
