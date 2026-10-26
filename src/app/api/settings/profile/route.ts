import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hashAdminPassword } from "@/lib/admin-security";

const input = z.object({ name: z.string().trim().max(120).optional(), email: z.string().trim().email().max(320).optional(), phone: z.string().trim().max(30).optional(), emailPreferences: z.union([z.literal("on"), z.literal("off")]).optional(), currentPassword: z.string().optional(), newPassword: z.string().min(8).max(200).optional() });
export async function PATCH(request: Request) {
  const session = await auth(); if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Data profil tidak valid." }, { status: 400 });
  const data = parsed.data; const user = await prisma.user.findUnique({ where: { id: session.user.id } }); if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  if (data.newPassword && (!data.currentPassword || !user.passwordHash || !(await bcrypt.compare(data.currentPassword, user.passwordHash)))) return NextResponse.json({ error: "Password lama wajib benar." }, { status: 400 });
  const email = (data.email ?? user.email).toLowerCase(); const existing = await prisma.user.findFirst({ where: { email, NOT: { id: user.id } }, select: { id: true } }); if (existing) return NextResponse.json({ error: "Email sudah digunakan." }, { status: 409 });
  const passwordHash = data.newPassword ? user.role === "ADMIN" ? await hashAdminPassword(data.newPassword) : await bcrypt.hash(data.newPassword, 12) : undefined;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { ...(data.name !== undefined ? { name: data.name || null } : {}), email, ...(data.phone !== undefined ? { phone: data.phone || null } : {}), ...(data.emailPreferences ? { emailPreferences: { marketing: data.emailPreferences === "on" } } : {}), ...(passwordHash ? { passwordHash, sessionVersion: { increment: 1 } } : {}) } });
    if (passwordHash && user.role === "ADMIN") await tx.auditLog.create({ data: { actorId: user.id, action: "ADMIN_PASSWORD_CHANGED", entityType: "User", entityId: user.id } });
  });
  return NextResponse.json({ ok: true });
}
