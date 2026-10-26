import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { payOrderWithBalance } from "@/lib/customer-wallet";
export async function POST(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await payOrderWithBalance((await params).orderId, session.user.id)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Pembayaran saldo gagal." }, { status: 400 }); }
}
