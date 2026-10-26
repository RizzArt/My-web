import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push/server";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  const subscription = endpoint ? await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { userId: true } }) : null;
  return NextResponse.json({ configured: isPushConfigured(), subscription: Boolean(subscription), linkedToAccount: subscription?.userId === session.user.id });
}
