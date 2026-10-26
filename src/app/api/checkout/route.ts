import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createCheckout } from "@/lib/payments/checkout";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const result = await createCheckout(session.user, await request.json()); return NextResponse.json(result, { status: 201 }); } catch (error) { const message = error instanceof Error ? error.message : "Checkout gagal"; return NextResponse.json({ error: message }, { status: message.includes("aktivasi") ? 503 : 400 }); }
}
