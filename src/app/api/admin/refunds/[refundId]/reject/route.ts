import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rejectRefund, publicRefund } from "@/lib/refunds";

const input = z.object({ adminNote: z.string().trim().min(3).max(500) });
export async function POST(request: Request, { params }: { params: Promise<{ refundId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Catatan admin wajib diisi." }, { status: 400 });
  try { const refund = await rejectRefund((await params).refundId, session.user.id, parsed.data.adminNote); return NextResponse.json({ refund: publicRefund(refund) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reject gagal." }, { status: 400 }); }
}
