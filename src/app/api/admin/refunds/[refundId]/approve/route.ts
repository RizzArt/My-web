import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { approveRefund, publicRefund } from "@/lib/refunds";

const input = z.object({ adminNote: z.string().trim().max(500).optional() });
export async function POST(request: Request, { params }: { params: Promise<{ refundId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Catatan admin tidak valid." }, { status: 400 });
  try { const refund = await approveRefund((await params).refundId, session.user.id, parsed.data.adminNote); return NextResponse.json({ refund: publicRefund(refund) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Approve gagal." }, { status: 400 }); }
}
