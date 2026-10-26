import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getVapidPublicKey, isPushConfigured } from "@/lib/push/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: isPushConfigured(), publicKey: getVapidPublicKey() });
}
