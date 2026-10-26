import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { drainPushQueue } from "@/lib/push/server";

const input = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }), userAgent: z.string().max(512).optional() });
const endpointInput = z.object({ endpoint: z.string().url().max(2048) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Subscription tidak valid." }, { status: 400 });
  await prisma.pushSubscription.upsert({ where: { endpoint: parsed.data.endpoint }, create: { userId: session.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent: parsed.data.userAgent }, update: { userId: session.user.id, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent: parsed.data.userAgent, lastSeenAt: new Date() } });
  void drainPushQueue(5).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = endpointInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Endpoint tidak valid." }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
