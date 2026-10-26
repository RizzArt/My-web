import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { reviewCustomerWithdrawal } from "@/lib/customer-withdrawals";
const input = z.object({ action: z.enum(["APPROVE", "REJECT", "PAID"]), adminNote: z.string().trim().max(500).optional(), transferReference: z.string().trim().max(120).optional() });
export async function POST(request: Request, { params }: { params: Promise<{ withdrawalId: string }> }) {
  const session = await auth(); if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Action tidak valid." }, { status: 400 });
  try { return NextResponse.json({ ok: true, withdrawal: await reviewCustomerWithdrawal((await params).withdrawalId, session.user.id, parsed.data.action, parsed.data.adminNote, parsed.data.transferReference) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Action gagal." }, { status: 400 }); }
}
