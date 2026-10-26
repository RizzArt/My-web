import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { markRefunded, publicRefund } from "@/lib/refunds";

const input = z.object({ adminNote: z.string().trim().max(500).optional(), transferReference: z.string().trim().max(120).optional() });
export async function POST(request: Request, { params }: { params: Promise<{ refundId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Data transfer tidak valid." }, { status: 400 });
  try { const refund = await markRefunded((await params).refundId, parsed.data.adminNote, parsed.data.transferReference); return NextResponse.json({ refund: publicRefund(refund) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mark refunded gagal." }, { status: 400 }); }
}
