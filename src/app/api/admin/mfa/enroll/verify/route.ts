import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { confirmAdminMfaEnrollment } from "@/lib/admin-mfa-service";

const input = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kode autentikator harus enam digit." }, { status: 400 });
  const recoveryCodes = await confirmAdminMfaEnrollment(session.user.id, parsed.data.code);
  if (!recoveryCodes) return NextResponse.json({ error: "Kode tidak valid atau enrollment sudah kedaluwarsa." }, { status: 400 });
  return NextResponse.json({ recoveryCodes, signInRequired: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
