import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { broadcastInput, createBroadcast } from "@/lib/notifications";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = broadcastInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Title, message, target, dan link tidak valid." }, { status: 400 });
  try {
    const broadcast = await createBroadcast(parsed.data, session.user.id);
    return NextResponse.json({ broadcast }, { status: 201 });
  } catch (error) {
    console.error("Broadcast failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Broadcast gagal dikirim." }, { status: 500 });
  }
}
