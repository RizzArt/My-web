import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createCustomerWithdrawal } from "@/lib/customer-withdrawals";
const input = z.object({ amount: z.number().int().positive(), payoutType: z.enum(["BANK", "EWALLET"]), payoutProvider: z.string().trim().min(2).max(80), accountNumber: z.string().trim().min(4).max(80), accountName: z.string().trim().min(2).max(120) });
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data penarikan tidak valid." }, { status: 400 });
  try { const withdrawal = await createCustomerWithdrawal({ ...parsed.data, userId: session.user.id }); return NextResponse.json({ ok: true, withdrawalId: withdrawal.id }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Penarikan gagal." }, { status: 400 }); }
}
