import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const input = z.object({ email: z.string().trim().email().max(320), reason: z.string().trim().min(3).max(500) });

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { orderId } = await params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email dan alasan perubahan wajib valid." }, { status: 400 });
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerEmail: true } });
  if (!order) return NextResponse.json({ error: "Order tidak ditemukan." }, { status: 404 });
  if (order.customerEmail === parsed.data.email.toLowerCase()) return NextResponse.json({ error: "Email delivery tidak berubah." }, { status: 400 });
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { customerEmail: parsed.data.email.toLowerCase(), emailStatus: "FAILED", lastEmailError: null } }),
    prisma.auditLog.create({ data: { actorId: session.user.id, action: "ORDER_DELIVERY_EMAIL_CHANGED", entityType: "Order", entityId: orderId, metadata: { from: order.customerEmail, to: parsed.data.email.toLowerCase(), reason: parsed.data.reason } } }),
  ]);
  return NextResponse.json({ ok: true });
}
