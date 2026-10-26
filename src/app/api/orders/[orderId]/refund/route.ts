import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createRefundRequest, publicRefund, StudioTopUpRefundBlocked, StudioTopUpRefundReviewRequired } from "@/lib/refunds";

const input = z.object({
  reason: z.string().trim().min(3, "Alasan refund wajib diisi.").max(1000),
  method: z.enum(["ACCOUNT_BALANCE", "MANUAL_TRANSFER"]),
  payoutType: z.enum(["BANK", "EWALLET"]).optional(),
  payoutProvider: z.string().trim().max(120).optional(),
  payoutAccountNumber: z.string().trim().min(4).max(80).optional(),
  payoutAccountName: z.string().trim().min(2).max(120).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data refund tidak valid." }, { status: 400 });
  try {
    const refund = await createRefundRequest({ ...(await params), userId: session.user.id, ...parsed.data });
    return NextResponse.json({ refund: publicRefund(refund) }, { status: 201 });
  } catch (error) {
    if (error instanceof StudioTopUpRefundReviewRequired || error instanceof StudioTopUpRefundBlocked) return NextResponse.json({ error: "Refund top up Studio Credit memerlukan peninjauan admin." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refund gagal dibuat." }, { status: 400 });
  }
}
