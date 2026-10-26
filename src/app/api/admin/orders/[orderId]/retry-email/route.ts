import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { retryOrderEmail } from "@/lib/delivery/service";

export async function POST(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { orderId } = await params;
  try { await retryOrderEmail(orderId); await prisma.auditLog.create({ data: { actorId: session.user.id, action: "ORDER_EMAIL_RETRIED", entityType: "Order", entityId: orderId } }); return NextResponse.json({ ok: true }); } catch (error) { console.error("Admin retry-email failed", { orderId, error: error instanceof Error ? error.message : error }); return NextResponse.json({ error: "Email tidak dapat dikirim ulang. Periksa konfigurasi email." }, { status: 400 }); }
}
