import QRCode from "qrcode";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/auth";
import { totpUri } from "@/lib/admin-mfa";
import { startAdminMfaEnrollment, verifyAdminMfaLogin } from "@/lib/admin-mfa-service";
import { prisma } from "@/lib/prisma";

const input = z.object({
  password: z.string().min(1).max(1024),
  mfaCode: z.string().trim().max(128).optional(),
}).strict();

const sensitiveHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const credential = await prisma.adminMfaCredential.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return NextResponse.json({ enabled: Boolean(credential) }, { headers: sensitiveHeaders });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Konfirmasi keamanan tidak valid." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, passwordHash: true, adminMfaCredential: { select: { id: true } } } });
  if (!user?.email || !user.passwordHash) return NextResponse.json({ error: "Admin harus memiliki password lokal sebelum mengaktifkan MFA." }, { status: 409 });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return NextResponse.json({ error: "Konfirmasi keamanan gagal." }, { status: 403 });
  if (user.adminMfaCredential) {
    const mfa = await verifyAdminMfaLogin(session.user.id, parsed.data.mfaCode ?? "");
    if (!mfa.verified) return NextResponse.json({ error: "Kode autentikator atau recovery code diperlukan untuk mengganti autentikator." }, { status: 403 });
  }
  const enrollment = await startAdminMfaEnrollment(session.user.id);
  const uri = totpUri({ secret: enrollment.secret, email: user.email });
  const qrCodeDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return NextResponse.json({ manualKey: enrollment.secret, qrCodeDataUrl, expiresAt: enrollment.expiresAt.toISOString() }, { headers: sensitiveHeaders });
}
