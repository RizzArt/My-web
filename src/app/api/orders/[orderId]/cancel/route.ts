import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { cancelUnpaidOrder, requestPaidCancellation } from "@/lib/customer-cancellation";

const input = z.object({ reason: z.string().trim().min(3).max(1000).optional() });
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Alasan tidak valid." }, { status: 400 });
  try {
    const orderId = (await params).orderId;
    const result = parsed.data.reason ? await requestPaidCancellation(orderId, session.user.id, parsed.data.reason) : await cancelUnpaidOrder(orderId, session.user.id);
    return NextResponse.json({ ok: true, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Pembatalan gagal." }, { status: 400 }); }
}
