import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueuePush, drainPushQueue, isPushConfigured } from "@/lib/push/server";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPushConfigured()) return NextResponse.json({ error: "Push belum dikonfigurasi di server." }, { status: 503 });
  await enqueuePush({ userId: session.user.id, dedupeKey: `test:${session.user.id}:${Date.now()}`, link: session.user.role === "ADMIN" ? "/admin" : session.user.role === "SELLER" ? "/seller" : "/dashboard", title: "Tes notifikasi Riezz99", body: "Push notification berhasil diterima." });
  void drainPushQueue(5).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
