import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notificationActionInput } from "@/lib/notifications";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 8);
  const take = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50) : 8;
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take }),
    prisma.notification.count({ where: { userId: session.user.id, isRead: false } }),
  ]);
  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = notificationActionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Notification tidak valid." }, { status: 400 });
  if (parsed.data.id) {
    const result = await prisma.notification.updateMany({ where: { id: parsed.data.id, userId: session.user.id }, data: { isRead: true } });
    if (!result.count) return NextResponse.json({ error: "Notification tidak ditemukan." }, { status: 404 });
  } else {
    await prisma.notification.updateMany({ where: { userId: session.user.id, isRead: false }, data: { isRead: true } });
  }
  return NextResponse.json({ ok: true });
}
